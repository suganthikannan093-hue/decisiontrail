import { Decision, DecisionLink, DecisionRepo } from '../domain/types';
import { linkKey } from '../domain/decisions';

/**
 * Cross-product bridge. Forge hosted storage is scoped per installation, and the
 * Jira and Confluence installs are separate installations, so the Confluence
 * macro cannot see decisions saved from Jira. Jira is the system of record that
 * both installs can reach: the Jira install mirrors decisions into an issue
 * entity property, and the Confluence install reads them with requestJira (JQL
 * over the indexed property). Atlassian-only APIs: no external egress.
 */
export const PROPERTY_KEY = 'decisiontrail';
export const SEARCH_JQL = `issue.property[${PROPERTY_KEY}].count > 0`;

export interface IssueProperty { count: number; decisions: Decision[] }

/** Minimal HTTP surface so tests can fake Jira. */
export interface JiraHttp {
  setIssueProperty(issueKey: string, value: IssueProperty): Promise<void>;
  deleteIssueProperty(issueKey: string): Promise<void>;
  searchIssueProperties(jql: string): Promise<IssueProperty[]>;
  /** F7: replace this app's remote links on an issue (optional so tests/fakes can omit it). */
  syncRemoteLinks?(issueKey: string, ds: Decision[]): Promise<void>;
}

export const buildIssueProperty = (ds: Decision[]): IssueProperty => ({ count: ds.length, decisions: ds });

const jiraKeys = (d?: Decision) => (d?.links ?? []).filter((l) => l.type === 'jira-issue').map((l) => l.id);

/** Jira-side repo decorator: every write refreshes the issue property of each affected issue. */
export class MirroringRepo implements DecisionRepo {
  constructor(private inner: DecisionRepo, private http: JiraHttp) {}
  get(id: string) { return this.inner.get(id); }
  listByTarget(l: DecisionLink) { return this.inner.listByTarget(l); }
  listAll(limit?: number) { return this.inner.listAll(limit); }
  async put(d: Decision) {
    const prev = await this.inner.get(d.id);
    await this.inner.put(d);
    await this.syncIssues([...jiraKeys(prev), ...jiraKeys(d)]);
  }
  async delete(id: string) {
    const prev = await this.inner.get(id);
    await this.inner.delete(id);
    await this.syncIssues(jiraKeys(prev));
  }
  async syncIssues(keys: string[]) {
    for (const key of new Set(keys)) {
      const ds = await this.inner.listByTarget({ type: 'jira-issue', id: key });
      if (ds.length) await this.http.setIssueProperty(key, buildIssueProperty(ds));
      else await this.http.deleteIssueProperty(key);
      // F7 links are best-effort: a failure must never block saving a decision
      if (this.http.syncRemoteLinks) await this.http.syncRemoteLinks(key, ds).catch((e) => console.warn('DecisionTrail remote link sync failed', key, String(e)));
    }
  }
}

/** Confluence-side repo: local (Confluence install) store plus decisions mirrored in Jira. Writes stay local. */
export class FederatedRepo implements DecisionRepo {
  constructor(private local: DecisionRepo, private http: JiraHttp) {}
  private async remote(): Promise<Decision[]> {
    try {
      const props = await this.http.searchIssueProperties(SEARCH_JQL);
      return props.flatMap((p) => p?.decisions ?? []);
    } catch (e) {
      console.warn('DecisionTrail: Jira decisions unavailable', e);
      return [];
    }
  }
  async get(id: string) {
    return (await this.local.get(id)) ?? (await this.remote()).find((d) => d.id === id);
  }
  put(d: Decision) { return this.local.put(d); }
  delete(id: string) { return this.local.delete(id); }
  async listByTarget(l: DecisionLink) {
    const k = linkKey(l);
    const remote = (await this.remote()).filter((d) => d.links.some((x) => linkKey(x) === k));
    return merge(await this.local.listByTarget(l), remote);
  }
  async listAll(limit = 500) {
    return merge(await this.local.listAll(limit), await this.remote()).slice(0, limit);
  }
}

/** Dedupe by id, newest updatedAt wins. */
export function merge(a: Decision[], b: Decision[]): Decision[] {
  const m = new Map<string, Decision>();
  for (const d of [...a, ...b]) {
    const cur = m.get(d.id);
    if (!cur || d.updatedAt > cur.updatedAt) m.set(d.id, d);
  }
  return [...m.values()];
}
