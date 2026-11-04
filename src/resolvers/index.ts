import Resolver from '@forge/resolver';
import { createDecisionService } from '../domain/decisions';
import { ForgeRepo } from '../storage/forgeRepo';
import { FederatedRepo, MirroringRepo, restoreFromMirror } from '../jira/bridge';
import kvs from '@forge/kvs';
import { DEMO_DECISIONS, demoSources } from '../domain/demo';
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
// With app.compatibility (Jira required, Confluence optional) both products share ONE installation
// and one store, so Confluence reads the same repo directly. Set DT_SPLIT_INSTALLS=1 only for legacy
// per-product installs, where Confluence federates Jira decisions from the mirrored issue property.
const confluenceRepo = process.env.DT_SPLIT_INSTALLS === '1' ? new FederatedRepo(local, forgeJiraHttp) : mirror;
const confluenceHandlers = buildHandlers(createDecisionService({ repo: confluenceRepo }), { labels: fetchLabels, baseUrl: jiraBaseUrl });

export const isConfluence = (ctx: Ctx) => /^(macro|confluence:)/.test(String(ctx.extension?.type ?? '')) || !!ctx.extension?.content;

/** Once per installation: restore decisions mirrored on Jira issues (survives reinstalls), citing demo comments. */
const RESTORED_FLAG = 'restored-from-mirror:v1';
let restoring: Promise<void> | undefined;
export const ensureRestored = () => (restoring ??= (async () => {
  if (await kvs.get(RESTORED_FLAG)) return;
  const n = await restoreFromMirror(local, forgeJiraHttp, async (d) => {
    const demo = DEMO_DECISIONS.find((x) => x.title === d.title);
    const key = d.links.find((l) => l.type === 'jira-issue')?.id;
    if (!demo || d.sources?.length || !key) return d;
    return { ...d, sources: demoSources(demo.evidence, (await readIssueThread(key)).comments) };
  });
  await kvs.set(RESTORED_FLAG, { at: new Date().toISOString(), restored: n });
  const keys = new Set((await local.listAll(500)).flatMap((d) => d.links.filter((l) => l.type === 'jira-issue').map((l) => l.id)));
  await mirror.syncIssues([...keys]);
})().catch((e) => { restoring = undefined; console.warn('DecisionTrail restore failed', String(e)); }));

const resolver = new Resolver();
for (const name of Object.keys(jiraHandlers) as (keyof typeof jiraHandlers)[]) {
  resolver.define(name, async ({ payload, context }) => {
    await ensureRestored();
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
