import Resolver from '@forge/resolver';
import { createDecisionService } from '../domain/decisions';
import { ForgeRepo } from '../storage/forgeRepo';
import { buildHandlers, Ctx } from './handlers';

const handlers = buildHandlers(createDecisionService({ repo: new ForgeRepo() }));
const resolver = new Resolver();
for (const [name, fn] of Object.entries(handlers)) {
  resolver.define(name, ({ payload, context }) => (fn as (p: any, c: Ctx) => Promise<unknown>)(payload, context as Ctx));
}
export const handler = resolver.getDefinitions();
