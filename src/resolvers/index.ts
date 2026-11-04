import Resolver from '@forge/resolver';
import { createDecisionService } from '../domain/decisions';
import { ForgeRepo } from '../storage/forgeRepo';
import { FederatedRepo, MirroringRepo } from '../jira/bridge';
import { forgeJiraHttp } from '../jira/forgeHttp';
import { jiraBaseUrl, readIssueThread } from '../jira/comments';
import { buildHandlers, Ctx } from './handlers';
import { fetchLabels, kvsConflictStore, liveGuardDeps, runGuard } from '../jira/guard';

const local = new ForgeRepo();
const mirror = new MirroringRepo(local, forgeJiraHttp);
const jiraHandlers = buildHandlers(createDecisionService({ repo: mirror }), {
  // backfill: viewing an issue panel refreshes that issue's mirrored property
  onContextView: (t) => (t.type === 'jira-issue' ? mirror.syncIssues([t.id]) : Promise.resolve()),
  conflicts: kvsConflictStore,
  labels: fetchLabels,
  baseUrl: jiraBaseUrl,
  issueComments: async (key) => (await readIssueThread(key)).comments,
});
const confluenceHandlers = buildHandlers(createDecisionService({ repo: new FederatedRepo(local, forgeJiraHttp) }), { labels: fetchLabels, baseUrl: jiraBaseUrl });

export const isConfluence = (ctx: Ctx) => /^(macro|confluence:)/.test(String(ctx.extension?.type ?? '')) || !!ctx.extension?.content;

const resolver = new Resolver();
for (const name of Object.keys(jiraHandlers) as (keyof typeof jiraHandlers)[]) {
  resolver.define(name, ({ payload, context }) => {
    const h = isConfluence(context as Ctx) ? confluenceHandlers : jiraHandlers;
    return (h[name] as (p: any, c: Ctx) => Promise<unknown>)(payload, context as Ctx);
  });
}
export const handler = resolver.getDefinitions();

/** F6 trigger: avi:jira:commented:issue (Jira install). Checks the issue's accepted decisions first, then all. */
export const conflictGuard = (event: unknown) =>
  runGuard(liveGuardDeps(async (issueKey) => {
    const onIssue = await local.listByTarget({ type: 'jira-issue', id: issueKey });
    const all = await local.listAll(200);
    const seen = new Set(onIssue.map((d) => d.id));
    return [...onIssue, ...all.filter((d) => !seen.has(d.id))].filter((d) => d.status === 'accepted');
  }), event).catch((e) => { console.error('DecisionTrail conflict guard failed', e); return []; });
