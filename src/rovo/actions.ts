import { createDecisionService, DecisionService, ValidationError } from '../domain/decisions';
import { DecisionLink } from '../domain/types';
import { ForgeRepo } from '../storage/forgeRepo';
import { FederatedRepo, MirroringRepo } from '../jira/bridge';
import { forgeJiraHttp } from '../jira/forgeHttp';
import { extractCandidates, formatExtraction } from '../domain/capture';
import { formatExplanation, rankDecisions } from '../domain/explain';
import { jiraBaseUrl, readIssueThread, readPageThread, Thread } from '../jira/comments';

/** Rovo action payload: flat string inputs as declared in manifest.yml */
export interface SaveDecisionPayload {
  title: string;
  rationale?: string;
  options?: string; // comma/newline separated
  status?: string;
  issueKey?: string;
  pageId?: string;
  sources?: string; // space/comma separated comment refs
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
        sources: (p.sources ?? '').split(/[\s,]+/).filter(Boolean),
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

type RovoCtx = { context?: { confluence?: unknown } };
// Confluence install reads Jira-mirrored decisions; Jira install mirrors its writes into Jira.
const svc = (p: RovoCtx) =>
  createDecisionService({
    repo: p.context?.confluence ? new FederatedRepo(new ForgeRepo(), forgeJiraHttp) : new MirroringRepo(new ForgeRepo(), forgeJiraHttp),
  });
export const saveDecision = (payload: SaveDecisionPayload) => saveDecisionWith(svc(payload), payload, payload.context?.accountId);
export const findDecisions = (payload: { query?: string; issueKey?: string } & RovoCtx) => findDecisionsWith(svc(payload), payload);

export interface ThreadReader { issue(key: string): Promise<Thread>; page(id: string): Promise<Thread> }

/** F1: read the thread in context and return it with heuristic candidate decisions (nothing is saved). */
export async function extractDecisionsWith(reader: ThreadReader, p: { issueKey?: string; pageId?: string; context?: SaveDecisionPayload['context'] }) {
  const issueKey = p.issueKey || p.context?.jira?.issueKey;
  const pageId = p.pageId || p.context?.confluence?.contentId;
  if (!issueKey && !pageId) return 'No Jira issue or Confluence page in context. Ask the user for an issue key or page id.';
  try {
    const target = issueKey ? `Jira issue ${issueKey}` : `Confluence page ${pageId}`;
    const t = issueKey ? await reader.issue(issueKey) : await reader.page(String(pageId));
    return formatExtraction(`${target} "${t.subject}"`, t.comments, extractCandidates(t.comments, t.subject));
  } catch (e) {
    return `Could not read comments: ${(e as Error).message}`;
  }
}

/** F2: rank recorded decisions for a "why" question and return cited facts. */
export async function explainWhyWith(svc: DecisionService, p: { question?: string; issueKey?: string }, base?: string) {
  const question = (p.question ?? '').trim();
  const all = await svc.list({});
  const pool = p.issueKey ? await svc.forTarget({ type: 'jira-issue', id: p.issueKey }) : all;
  const hits = rankDecisions(question || p.issueKey || '', pool);
  return formatExplanation(question || `decisions on ${p.issueKey}`, p.issueKey && !question ? pool.slice(0, 3) : hits, all, base);
}

const liveReader: ThreadReader = { issue: readIssueThread, page: readPageThread };
export const extractDecisions = (payload: any) => extractDecisionsWith(liveReader, payload);
export const explainWhy = async (payload: { question?: string; issueKey?: string } & RovoCtx) =>
  explainWhyWith(svc(payload), payload, await jiraBaseUrl());
