import { Decision, DecisionInput, DecisionLink, DecisionRepo, LinkType, STATUSES } from './types';

export class ValidationError extends Error {}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const PAGE_ID = /^\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const linkKey = (l: DecisionLink) => `${l.type}:${l.id}`;

export function validateLink(l: DecisionLink): DecisionLink {
  const type = l?.type as LinkType;
  const id = String(l?.id ?? '').trim();
  if (type === 'jira-issue' && ISSUE_KEY.test(id.toUpperCase())) return { type, id: id.toUpperCase() };
  if (type === 'confluence-page' && PAGE_ID.test(id)) return { type, id };
  throw new ValidationError(`Invalid link: ${type}:${id}`);
}

function dedupeLinks(links: DecisionLink[]): DecisionLink[] {
  const seen = new Map<string, DecisionLink>();
  for (const l of links.map(validateLink)) seen.set(linkKey(l), l);
  return [...seen.values()];
}

export function normalizeInput(input: DecisionInput, now: Date): Omit<Decision, 'id' | 'createdAt' | 'updatedAt'> {
  const title = (input?.title ?? '').trim();
  if (title.length < 3 || title.length > 200) throw new ValidationError('Title must be 3-200 characters');
  const status = input.status ?? 'proposed';
  if (!STATUSES.includes(status)) throw new ValidationError(`Unknown status: ${status}`);
  const date = input.date ?? now.toISOString().slice(0, 10);
  if (!ISO_DATE.test(date)) throw new ValidationError('Date must be YYYY-MM-DD');
  const options = (input.options ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 20);
  return {
    title,
    rationale: (input.rationale ?? '').trim().slice(0, 5000),
    options,
    status,
    decidedBy: input.decidedBy ?? '',
    date,
    links: dedupeLinks(input.links ?? []),
    supersedes: input.supersedes || undefined,
    ...(input.sources?.length ? { sources: [...new Set(input.sources.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20) } : {}),
  };
}

export interface ServiceDeps {
  repo: DecisionRepo;
  now?: () => Date;
  newId?: () => string;
}

export function createDecisionService({ repo, now = () => new Date(), newId = defaultId }: ServiceDeps) {
  async function markSuperseded(oldId: string, newIdValue: string) {
    const old = await repo.get(oldId);
    if (!old) throw new ValidationError(`Superseded decision not found: ${oldId}`);
    if (old.id === newIdValue) throw new ValidationError('A decision cannot supersede itself');
    await repo.put({ ...old, status: 'superseded', supersededBy: newIdValue, updatedAt: now().toISOString() });
  }

  return {
    async create(input: DecisionInput, actor?: string): Promise<Decision> {
      const n = now();
      const base = normalizeInput({ ...input, decidedBy: input.decidedBy || actor }, n);
      const d: Decision = { ...base, id: newId(), createdAt: n.toISOString(), updatedAt: n.toISOString() };
      if (d.supersedes) await markSuperseded(d.supersedes, d.id);
      await repo.put(d);
      return d;
    },
    async get(id: string) {
      return repo.get(id);
    },
    async update(id: string, patch: Partial<DecisionInput>): Promise<Decision> {
      const cur = await repo.get(id);
      if (!cur) throw new ValidationError(`Decision not found: ${id}`);
      const merged = normalizeInput({ ...cur, ...patch }, now());
      const d: Decision = { ...cur, ...merged, updatedAt: now().toISOString() };
      if (patch.supersedes && patch.supersedes !== cur.supersedes) await markSuperseded(patch.supersedes, id);
      await repo.put(d);
      return d;
    },
    async remove(id: string) {
      await repo.delete(id);
    },
    async link(id: string, link: DecisionLink): Promise<Decision> {
      const cur = await repo.get(id);
      if (!cur) throw new ValidationError(`Decision not found: ${id}`);
      const d = { ...cur, links: dedupeLinks([...cur.links, link]), updatedAt: now().toISOString() };
      await repo.put(d);
      return d;
    },
    async unlink(id: string, link: DecisionLink): Promise<Decision> {
      const cur = await repo.get(id);
      if (!cur) throw new ValidationError(`Decision not found: ${id}`);
      const key = linkKey(validateLink(link));
      const d = { ...cur, links: cur.links.filter((l) => linkKey(l) !== key), updatedAt: now().toISOString() };
      await repo.put(d);
      return d;
    },
    async forTarget(link: DecisionLink) {
      return sortDecisions(await repo.listByTarget(validateLink(link)));
    },
    async list(filter: { status?: string; query?: string } = {}) {
      let all = await repo.listAll(500);
      if (filter.status) all = all.filter((d) => d.status === filter.status);
      if (filter.query) {
        const q = filter.query.toLowerCase();
        all = all.filter((d) => `${d.title} ${d.rationale} ${d.options.join(' ')}`.toLowerCase().includes(q));
      }
      return sortDecisions(all);
    },
  };
}

export type DecisionService = ReturnType<typeof createDecisionService>;

const ORDER = { accepted: 0, proposed: 1, superseded: 2, rejected: 3 } as const;
export function sortDecisions(ds: Decision[]): Decision[] {
  return [...ds].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.date.localeCompare(a.date));
}

function defaultId() {
  return `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
