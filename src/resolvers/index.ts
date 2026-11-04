import Resolver from '@forge/resolver';
import { createDecisionService } from '../domain/decisions';
import { ForgeRepo } from '../storage/forgeRepo';
import { FederatedRepo, MirroringRepo } from '../jira/bridge';
import { forgeJiraHttp } from '../jira/forgeHttp';
import { buildHandlers, Ctx } from './handlers';

const local = new ForgeRepo();
const mirror = new MirroringRepo(local, forgeJiraHttp);
const jiraHandlers = buildHandlers(createDecisionService({ repo: mirror }), {
  // backfill: viewing an issue panel refreshes that issue's mirrored property
  onContextView: (t) => (t.type === 'jira-issue' ? mirror.syncIssues([t.id]) : Promise.resolve()),
});
const confluenceHandlers = buildHandlers(createDecisionService({ repo: new FederatedRepo(local, forgeJiraHttp) }));

export const isConfluence = (ctx: Ctx) => String(ctx.extension?.type ?? '').startsWith('macro') || !!ctx.extension?.content;

const resolver = new Resolver();
for (const name of Object.keys(jiraHandlers) as (keyof typeof jiraHandlers)[]) {
  resolver.define(name, ({ payload, context }) => {
    const h = isConfluence(context as Ctx) ? confluenceHandlers : jiraHandlers;
    return (h[name] as (p: any, c: Ctx) => Promise<unknown>)(payload, context as Ctx);
  });
}
export const handler = resolver.getDefinitions();
