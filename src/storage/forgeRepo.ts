import kvs, { WhereConditions } from '@forge/kvs';
import { linkKey } from '../domain/decisions';
import { Decision, DecisionLink, DecisionRepo } from '../domain/types';

/**
 * Forge custom-entity storage.
 * - entity `decision`: the Decision document (key = decision id)
 * - entity `decisionlink`: one row per (decision, target) for fast lookup by issue/page
 */
const DECISION = 'decision';
const LINK = 'decisionlink';

interface LinkRow { decisionId: string; target: string; }

export class ForgeRepo implements DecisionRepo {
  async get(id: string) {
    return (await kvs.entity<Decision>(DECISION).get(id)) ?? undefined;
  }

  async put(d: Decision) {
    const prev = await this.get(d.id);
    const before = new Set((prev?.links ?? []).map(linkKey));
    const after = new Set(d.links.map(linkKey));
    // custom entities reject empty/undefined attribute values; drop them
    const clean = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Decision;
    await kvs.entity<Decision>(DECISION).set(d.id, clean);
    for (const t of after) if (!before.has(t)) await kvs.entity<LinkRow>(LINK).set(rowKey(d.id, t), { decisionId: d.id, target: t });
    for (const t of before) if (!after.has(t)) await kvs.entity<LinkRow>(LINK).delete(rowKey(d.id, t));
  }

  async delete(id: string) {
    const prev = await this.get(id);
    for (const l of prev?.links ?? []) await kvs.entity<LinkRow>(LINK).delete(rowKey(id, linkKey(l)));
    await kvs.entity<Decision>(DECISION).delete(id);
  }

  async listByTarget(l: DecisionLink) {
    const rows = await kvs.entity<LinkRow>(LINK).query().index('by-target').where(WhereConditions.equalTo(linkKey(l))).limit(100).getMany();
    const ds = await Promise.all(rows.results.map((r) => this.get(r.value.decisionId)));
    return ds.filter((d): d is Decision => !!d);
  }

  async listAll(limit = 500) {
    const out: Decision[] = [];
    let cursor: string | undefined;
    do {
      let q = kvs.entity<Decision>(DECISION).query().index('by-updated').limit(Math.min(100, limit - out.length));
      if (cursor) q = q.cursor(cursor);
      const page = await q.getMany();
      out.push(...page.results.map((r) => r.value));
      cursor = page.nextCursor;
    } while (cursor && out.length < limit);
    return out;
  }
}

// entity keys allow [a-zA-Z0-9:._\s-#]; sanitise just in case
const rowKey = (id: string, target: string) => `${id}|${target}`.replace(/[^a-zA-Z0-9:._\-#]/g, '_');
