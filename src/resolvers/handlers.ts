import { DecisionService, ValidationError } from '../domain/decisions';
import { DecisionInput, DecisionLink } from '../domain/types';

export interface Ctx { accountId?: string; extension?: Record<string, any> }
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    console.error('DecisionTrail resolver error', e);
    return { ok: false, error: 'Unexpected error' };
  }
}

/** Derive the current Jira issue / Confluence page from the Forge extension context. */
export function contextTarget(ctx: Ctx): DecisionLink | undefined {
  const ext = ctx.extension ?? {};
  if (ext.issue?.key) return { type: 'jira-issue', id: ext.issue.key };
  if (ext.content?.id) return { type: 'confluence-page', id: String(ext.content.id) };
  return undefined;
}

export interface HandlerHooks { onContextView?: (t: DecisionLink) => Promise<void> }

export function buildHandlers(svc: DecisionService, hooks: HandlerHooks = {}) {
  return {
    listForContext: (_p: unknown, ctx: Ctx) =>
      wrap(async () => {
        const t = contextTarget(ctx);
        if (t && hooks.onContextView) await hooks.onContextView(t).catch((e) => console.warn('DecisionTrail: sync failed', e));
        return t ? { target: t, decisions: await svc.forTarget(t) } : { target: null, decisions: [] };
      }),
    listDecisions: (p: { status?: string; query?: string }) => wrap(() => svc.list(p ?? {})),
    getDecision: (p: { id: string }) => wrap(() => svc.get(p.id)),
    createDecision: (p: { decision: DecisionInput; linkToContext?: boolean }, ctx: Ctx) =>
      wrap(() => {
        const input = { ...p.decision, links: [...(p.decision?.links ?? [])] };
        const t = contextTarget(ctx);
        if (p.linkToContext !== false && t) input.links.push(t);
        return svc.create(input, ctx.accountId);
      }),
    updateDecision: (p: { id: string; patch: Partial<DecisionInput> }) => wrap(() => svc.update(p.id, p.patch)),
    deleteDecision: (p: { id: string }) => wrap(async () => { await svc.remove(p.id); return { id: p.id }; }),
    linkDecision: (p: { id: string; link?: DecisionLink }, ctx: Ctx) =>
      wrap(() => {
        const l = p.link ?? contextTarget(ctx);
        if (!l) throw new ValidationError('No link target');
        return svc.link(p.id, l);
      }),
    unlinkDecision: (p: { id: string; link: DecisionLink }) => wrap(() => svc.unlink(p.id, p.link)),
  };
}
