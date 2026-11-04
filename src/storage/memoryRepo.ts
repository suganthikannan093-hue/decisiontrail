import { linkKey } from '../domain/decisions';
import { Decision, DecisionLink, DecisionRepo } from '../domain/types';

export class MemoryRepo implements DecisionRepo {
  private items = new Map<string, Decision>();
  async get(id: string) { return this.items.get(id); }
  async put(d: Decision) { this.items.set(d.id, structuredClone(d)); }
  async delete(id: string) { this.items.delete(id); }
  async listByTarget(l: DecisionLink) {
    const k = linkKey(l);
    return [...this.items.values()].filter((d) => d.links.some((x) => linkKey(x) === k));
  }
  async listAll(limit = 500) { return [...this.items.values()].slice(0, limit); }
}
