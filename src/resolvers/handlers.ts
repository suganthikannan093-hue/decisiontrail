import { DecisionService, ValidationError } from '../domain/decisions';
import { DecisionInput, DecisionLink } from '../domain/types';
import { ConflictStore } from '../domain/conflict';
import { buildGraph } from '../domain/graph';
import { healthReport, toAdrMarkdown } from '../domain/health';
import { DEMO_DECISIONS, demoSources } from '../domain/demo';

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

export interface HandlerHooks {
  onContextView?: (t: DecisionLink) => Promise<void>;
  conflicts?: ConflictStore;
  /** comments on an issue, used to cite demo sources */
  issueComments?: (issueKey: string) => Promise<{ ref: string; text: string }[]>;
  baseUrl?: () => Promise<string | undefined>;
  labels?: (issueKeys: string[], pageIds: string[]) => Promise<Record<string, string>>;
}

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
    // F6: conflicts flagged by the comment trigger for the issue in context
    listConflicts: (_p: unknown, ctx: Ctx) =>
      wrap(async () => {
        const t = contextTarget(ctx);
        return t?.type === 'jira-issue' && hooks.conflicts ? hooks.conflicts.list(t.id) : [];
      }),
    dismissConflict: (p: { commentRef: string; decisionId: string }, ctx: Ctx) =>
      wrap(async () => {
        const t = contextTarget(ctx);
        if (t?.type !== 'jira-issue' || !hooks.conflicts) throw new ValidationError('Conflicts are only available on Jira issues');
        const rest = (await hooks.conflicts.list(t.id)).filter((c) => !(c.commentRef === p.commentRef && c.decisionId === p.decisionId));
        await hooks.conflicts.save(t.id, rest);
        return rest;
      }),
    /** Record the change of course as a new accepted decision that supersedes the old one. */
    supersedeFromConflict: (p: { commentRef: string; decisionId: string; title?: string; rationale?: string }, ctx: Ctx) =>
      wrap(async () => {
        const t = contextTarget(ctx);
        if (t?.type !== 'jira-issue' || !hooks.conflicts) throw new ValidationError('Conflicts are only available on Jira issues');
        const all = await hooks.conflicts.list(t.id);
        const c = all.find((x) => x.commentRef === p.commentRef && x.decisionId === p.decisionId);
        if (!c) throw new ValidationError('Conflict not found (already resolved?)');
        const old = await svc.get(c.decisionId);
        if (!old) throw new ValidationError(`Decision not found: ${c.decisionId}`);
        const topic = old.title.match(/\s(for|as|in|on)\s.+$/i)?.[0] ?? '';
        const d = await svc.create({
          title: p.title?.trim() || `Use ${c.proposed}${topic}`,
          rationale: p.rationale?.trim() || `Supersedes "${old.title}". Raised in comment: ${c.excerpt}`,
          options: old.options, status: 'accepted', supersedes: old.id,
          links: [...old.links], sources: [c.commentRef],
        }, ctx.accountId);
        await hooks.conflicts.save(t.id, all.filter((x) => x !== c));
        return d;
      }),
    // F5: traceability graph (optionally scoped to the Jira project in context)
    traceGraph: (p: { project?: string } | undefined, ctx: Ctx) =>
      wrap(async () => {
        const ds = await svc.list({});
        const project = p?.project ?? ctx.extension?.project?.key;
        const keys = [...new Set(ds.flatMap((d) => d.links.filter((l) => l.type === 'jira-issue').map((l) => l.id)))];
        const pages = [...new Set(ds.flatMap((d) => d.links.filter((l) => l.type === 'confluence-page').map((l) => l.id)))];
        const labels = hooks.labels ? await hooks.labels(keys, pages).catch(() => ({})) : {};
        return buildGraph(ds, labels, { project });
      }),
    // F8: dashboard gadget
    decisionHealth: (p: { staleDays?: number; status?: string } | undefined) =>
      wrap(async () => {
        const ds = await svc.list({});
        const r = healthReport(ds, new Date(), p?.staleDays ?? 14);
        const pick = (xs: typeof ds) => xs.map(({ id, title, status, date }) => ({ id, title, status, date }));
        return { ...r, noOwner: pick(r.noOwner), stale: pick(r.stale), unlinked: pick(r.unlinked) };
      }),
    exportAdr: (p: { status?: string } | undefined, ctx: Ctx) =>
      wrap(async () => {
        const ds = await svc.list(p?.status ? { status: p.status } : {});
        return { markdown: toAdrMarkdown(ds, { base: ctx.extension?.siteUrl ?? (hooks.baseUrl ? (await hooks.baseUrl().catch(() => undefined)) ?? '' : '') }), count: ds.length };
      }),
    // Onboarding: load the fictional Acme demo onto the current issue (idempotent by title)
    seedDemo: (_p: unknown, ctx: Ctx) =>
      wrap(async () => {
        const t = contextTarget(ctx);
        if (t?.type !== 'jira-issue') throw new ValidationError('Open a Jira issue to load the demo');
        const existing = await svc.forTarget(t);
        const comments = hooks.issueComments ? await hooks.issueComments(t.id).catch(() => []) : [];
        const ids: Record<string, string> = {};
        let created = 0;
        let cited = 0;
        for (const demo of DEMO_DECISIONS) {
          const { ref, supersedesRef, noOwner, evidence, ...input } = demo;
          const sources = demoSources(evidence, comments);
          const prev = existing.find((d) => d.title === demo.title);
          if (prev) {
            ids[ref] = prev.id;
            // backfill citations on earlier seeds that had none
            if (!prev.sources?.length && sources.length) { await svc.update(prev.id, { sources }); cited++; }
            continue;
          }
          const d = await svc.create({ ...input, sources, supersedes: supersedesRef ? ids[supersedesRef] : undefined, links: [t] }, noOwner ? undefined : ctx.accountId);
          ids[ref] = d.id; created++; if (sources.length) cited++;
        }
        return { created, cited };
      }),
  };
}
