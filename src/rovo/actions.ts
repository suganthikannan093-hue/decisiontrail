import { createDecisionService, DecisionService, ValidationError } from '../domain/decisions';
import { DecisionLink } from '../domain/types';
import { ForgeRepo } from '../storage/forgeRepo';

/** Rovo action payload: flat string inputs as declared in manifest.yml */
export interface SaveDecisionPayload {
  title: string;
  rationale?: string;
  options?: string; // comma/newline separated
  status?: string;
  issueKey?: string;
  pageId?: string;
  context?: { jira?: { issueKey?: string }; confluence?: { contentId?: string }; accountId?: string };
}

export async function saveDecisionWith(svc: DecisionService, p: SaveDecisionPayload, accountId?: string) {
  const links: DecisionLink[] = [];
  const issueKey = p.issueKey || p.context?.jira?.issueKey;
  const pageId = p.pageId || p.context?.confluence?.contentId;
  if (issueKey) links.push({ type: 'jira-issue', id: issueKey });
  if (pageId) links.push({ type: 'confluence-page', id: String(pageId) });
  try {
    const d = await svc.create(
      {
        title: p.title,
        rationale: p.rationale,
        options: (p.options ?? '').split(/[,\n]/),
        status: (p.status as never) || 'proposed',
        links,
      },
      accountId,
    );
    return `Saved decision "${d.title}" (${d.id}), status ${d.status}, linked to ${d.links.map((l) => l.id).join(', ') || 'nothing yet'}.`;
  } catch (e) {
    if (e instanceof ValidationError) return `Could not save decision: ${e.message}`;
    throw e;
  }
}

export async function findDecisionsWith(svc: DecisionService, p: { query?: string; issueKey?: string }) {
  const ds = p.issueKey ? await svc.forTarget({ type: 'jira-issue', id: p.issueKey }) : await svc.list({ query: p.query });
  if (!ds.length) return 'No matching decisions found.';
  return ds.slice(0, 10).map((d) => `- [${d.status}] ${d.title} (${d.date}, ${d.id}): ${d.rationale || 'no rationale recorded'}`).join('\n');
}

const svc = () => createDecisionService({ repo: new ForgeRepo() });
export const saveDecision = (payload: SaveDecisionPayload) => saveDecisionWith(svc(), payload, payload.context?.accountId);
export const findDecisions = (payload: { query?: string; issueKey?: string }) => findDecisionsWith(svc(), payload);
