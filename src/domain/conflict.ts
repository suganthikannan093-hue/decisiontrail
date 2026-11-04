import { Decision } from './types';

/**
 * F6 conflict and reversal guard (heuristic, runs in a Forge trigger, no egress).
 * A comment conflicts with an accepted decision when it proposes switching to one
 * of the rejected options, or proposes dropping/replacing the chosen option.
 */
export interface Conflict {
  decisionId: string;
  decisionTitle: string;
  chosen: string;
  proposed: string;
  commentRef: string; // jira:ACME-1#10010
  issueKey: string;
  author: string;
  excerpt: string;
  reason: string;
  ownerAccountId?: string;
  detectedAt: string;
}

export const GUARD_MARKER = 'DecisionTrail conflict guard';

/** The chosen option: from "Use X for Y" titles, else the first option. */
export function chosenOf(d: Decision): string {
  const m = d.title.match(/^(?:use|adopt|choose|go with|pick|standardi[sz]e on)\s+(.+?)(?:\s+(?:for|as|in|on|to)\b.*)?$/i);
  return (m?.[1] ?? d.options[0] ?? '').trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (t: string, w: string) => !!w && new RegExp(`(^|[^\\w])${esc(w)}([^\\w]|$)`, 'i').test(t);

const TOWARD = (o: string) => new RegExp(`\\b(switch(?:ing)?|mov(?:e|ing)|migrat(?:e|ing)|go(?:ing)? back|revert(?:ing)?|chang(?:e|ing)|standardi[sz]e)\\s+(?:\\w+\\s+){0,3}(?:to|on)\\s+${esc(o)}|\\b(?:let'?s|we should|should we|i propose(?: we)?|propose(?: we)?|how about|why not)\\s+(?:just\\s+)?(?:use|go with|try|adopt|pick)\\s+${esc(o)}|\\buse\\s+${esc(o)}\\s+instead|\\b${esc(o)}\\s+instead\\b|\\breplace\\s+\\S+(?:\\s\\S+)?\\s+with\\s+${esc(o)}`, 'i');
const AWAY = (c: string) => new RegExp(`\\b(drop(?:ping)?|ditch(?:ing)?|abandon(?:ing)?|replac(?:e|ing)|get rid of|mov(?:e|ing) (?:away )?from|migrat(?:e|ing) (?:away )?(?:off|from)|instead of|stop using|rip out|reconsider)\\s+(?:the\\s+)?${esc(c)}`, 'i');

export function detectConflicts(
  comment: { ref: string; issueKey: string; author: string; text: string },
  accepted: Decision[],
  now = new Date(),
): Conflict[] {
  const t = comment.text;
  if (!t || t.includes(GUARD_MARKER)) return [];
  const out: Conflict[] = [];
  for (const d of accepted) {
    if (d.status !== 'accepted') continue;
    const chosen = chosenOf(d);
    if (!chosen) continue;
    const alts = d.options.filter((o) => o.toLowerCase() !== chosen.toLowerCase());
    let proposed = alts.find((a) => mentions(t, a) && TOWARD(a).test(t));
    let reason = proposed ? `proposes ${proposed}, an option this decision rejected` : '';
    if (!proposed && AWAY(chosen).test(t)) {
      proposed = alts.find((a) => mentions(t, a)) ?? 'an alternative';
      reason = `proposes moving away from ${chosen}`;
    }
    if (!proposed) continue;
    out.push({
      decisionId: d.id, decisionTitle: d.title, chosen, proposed, reason,
      commentRef: comment.ref, issueKey: comment.issueKey, author: comment.author,
      excerpt: t.trim().slice(0, 280), ownerAccountId: /^[\w:-]{10,}$/.test(d.decidedBy) ? d.decidedBy : undefined,
      detectedAt: now.toISOString(),
    });
  }
  return out;
}

/** ADF body for the owner notification comment. */
export function notificationAdf(c: Conflict) {
  const who = c.ownerAccountId
    ? [{ type: 'mention', attrs: { id: c.ownerAccountId } }, { type: 'text', text: ' ' }]
    : [];
  return {
    type: 'doc', version: 1,
    content: [{
      type: 'panel', attrs: { panelType: 'warning' },
      content: [{
        type: 'paragraph',
        content: [
          ...who,
          { type: 'text', text: `${GUARD_MARKER}: this comment ${c.reason}. It may contradict the accepted decision ` },
          { type: 'text', text: `"${c.decisionTitle}" (${c.decisionId})`, marks: [{ type: 'strong' }] },
          { type: 'text', text: '. If the team is changing course, record a new decision that supersedes it from the Decisions panel; otherwise dismiss the flag there.' },
        ],
      }],
    }],
  };
}

export interface ConflictStore {
  list(issueKey: string): Promise<Conflict[]>;
  save(issueKey: string, cs: Conflict[]): Promise<void>;
}

/** Add new conflicts, skipping duplicates of the same comment+decision. Returns only the new ones. */
export async function recordConflicts(store: ConflictStore, issueKey: string, found: Conflict[]): Promise<Conflict[]> {
  if (!found.length) return [];
  const cur = await store.list(issueKey);
  const seen = new Set(cur.map((c) => `${c.commentRef}|${c.decisionId}`));
  const fresh = found.filter((c) => !seen.has(`${c.commentRef}|${c.decisionId}`));
  if (fresh.length) await store.save(issueKey, [...cur, ...fresh].slice(-50));
  return fresh;
}

export class MemoryConflictStore implements ConflictStore {
  m = new Map<string, Conflict[]>();
  async list(k: string) { return this.m.get(k) ?? []; }
  async save(k: string, cs: Conflict[]) { this.m.set(k, cs); }
}
