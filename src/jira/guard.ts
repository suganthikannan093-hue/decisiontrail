import api, { route } from '@forge/api';
import kvs from '@forge/kvs';
import { adfToText } from '../domain/capture';
import { Conflict, ConflictStore, detectConflicts, notificationAdf, recordConflicts } from '../domain/conflict';
import { Decision } from '../domain/types';

export const kvsConflictStore: ConflictStore = {
  async list(k) { return ((await kvs.get(`conflicts:${k}`)) as Conflict[] | undefined) ?? []; },
  async save(k, cs) { if (cs.length) await kvs.set(`conflicts:${k}`, cs); else await kvs.delete(`conflicts:${k}`); },
};

export interface GuardDeps {
  readComment(issueKey: string, commentId: string): Promise<{ author: string; accountType?: string; text: string } | undefined>;
  acceptedDecisions(issueKey: string): Promise<Decision[]>;
  store: ConflictStore;
  notify(issueKey: string, c: Conflict): Promise<void>;
}

/** Core of the comment-created trigger; injectable for tests. */
export async function runGuard(deps: GuardDeps, event: any): Promise<Conflict[]> {
  const issueKey: string | undefined = event?.issue?.key;
  const commentId: string | undefined = event?.comment?.id;
  if (!issueKey || !commentId) return [];
  const c = await deps.readComment(issueKey, String(commentId));
  if (!c || c.accountType === 'app') return []; // never react to our own (or other apps') comments
  const found = detectConflicts({ ref: `jira:${issueKey}#${commentId}`, issueKey, author: c.author, text: c.text }, await deps.acceptedDecisions(issueKey));
  const fresh = await recordConflicts(deps.store, issueKey, found);
  for (const f of fresh) await deps.notify(issueKey, f);
  return fresh;
}

export const liveGuardDeps = (decisions: (issueKey: string) => Promise<Decision[]>): GuardDeps => ({
  async readComment(issueKey, id) {
    const r = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${id}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return undefined;
    const j: any = await r.json();
    return { author: j.author?.displayName ?? 'unknown', accountType: j.author?.accountType, text: adfToText(j.body) };
  },
  acceptedDecisions: decisions,
  store: kvsConflictStore,
  async notify(issueKey, c) {
    const r = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: notificationAdf(c) }),
    });
    if (!r.ok) console.warn('DecisionTrail: notify failed', r.status);
  },
});

/** Best-effort titles for graph nodes (issue summaries, page titles). */
export async function fetchLabels(issueKeys: string[], pageIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    if (issueKeys.length) {
      const r = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jql: `key in (${issueKeys.slice(0, 50).join(',')})`, fields: ['summary'], maxResults: 50 }),
      });
      if (r.ok) for (const i of ((await r.json()) as any).issues ?? []) out[`issue:${i.key}`] = i.fields?.summary ?? '';
    }
  } catch (e) { console.warn('DecisionTrail: issue labels', e); }
  try {
    if (pageIds.length) {
      const r = await api.asUser().requestConfluence(route`/wiki/api/v2/pages?id=${pageIds.slice(0, 50).join(',')}`, { headers: { Accept: 'application/json' } });
      if (r.ok) for (const p of ((await r.json()) as any).results ?? []) out[`page:${p.id}`] = p.title ?? '';
    }
  } catch (e) { console.warn('DecisionTrail: page labels', e); }
  return out;
}
