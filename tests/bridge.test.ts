import { describe, expect, it } from 'vitest';
import { createDecisionService } from '../src/domain/decisions';
import { MemoryRepo } from '../src/storage/memoryRepo';
import { FederatedRepo, IssueProperty, JiraHttp, merge, MirroringRepo, SEARCH_JQL } from '../src/jira/bridge';
import { buildHandlers } from '../src/resolvers/handlers';

/** Fake Jira: issue properties plus the JQL the Confluence side issues. */
function fakeJira() {
  const props = new Map<string, IssueProperty>();
  const jqls: string[] = [];
  const http: JiraHttp = {
    async setIssueProperty(k, v) { props.set(k, JSON.parse(JSON.stringify(v))); },
    async deleteIssueProperty(k) { props.delete(k); },
    async searchIssueProperties(jql) { jqls.push(jql); return [...props.values()].filter((p) => p.count > 0); },
  };
  return { props, jqls, http };
}

const kafka = {
  title: 'Use Kafka for order events',
  rationale: 'Need replay and high throughput; RabbitMQ lacks log retention',
  options: ['Kafka', 'RabbitMQ', 'SQS'],
  status: 'accepted' as const,
};

describe('Jira <-> Confluence bridge (separate per-install storage)', () => {
  it('decision saved in Jira shows in the Confluence decision log', async () => {
    const jira = fakeJira();
    const jiraSvc = createDecisionService({ repo: new MirroringRepo(new MemoryRepo(), jira.http) });
    const conf = buildHandlers(createDecisionService({ repo: new FederatedRepo(new MemoryRepo(), jira.http) }));

    const jiraH = buildHandlers(jiraSvc);
    const r: any = await jiraH.createDecision({ decision: kafka }, { extension: { issue: { key: 'ACME-1' } } });
    expect(r.ok).toBe(true);
    expect(jira.props.get('ACME-1')?.count).toBe(1);

    const log: any = await conf.listDecisions({});
    expect(log.ok).toBe(true);
    expect(log.data.map((d: any) => d.title)).toEqual([kafka.title]);
    expect(jira.jqls[0]).toBe(SEARCH_JQL);
    const accepted: any = await conf.listDecisions({ status: 'accepted' });
    expect(accepted.data).toHaveLength(1);
  });

  it('removes the mirror when the last decision leaves an issue', async () => {
    const jira = fakeJira();
    const svc = createDecisionService({ repo: new MirroringRepo(new MemoryRepo(), jira.http) });
    const d = await svc.create({ ...kafka, links: [{ type: 'jira-issue', id: 'ACME-1' }] });
    await svc.unlink(d.id, { type: 'jira-issue', id: 'ACME-1' });
    expect(jira.props.has('ACME-1')).toBe(false);
  });

  it('page-scoped Confluence view merges local and Jira decisions linked to the page', async () => {
    const jira = fakeJira();
    const jsvc = createDecisionService({ repo: new MirroringRepo(new MemoryRepo(), jira.http) });
    await jsvc.create({ ...kafka, links: [{ type: 'jira-issue', id: 'ACME-1' }, { type: 'confluence-page', id: '360449' }] });
    const csvc = createDecisionService({ repo: new FederatedRepo(new MemoryRepo(), jira.http) });
    await csvc.create({ title: 'Local page decision', links: [{ type: 'confluence-page', id: '360449' }] });
    const ds = await csvc.forTarget({ type: 'confluence-page', id: '360449' });
    expect(ds.map((d) => d.title).sort()).toEqual(['Local page decision', kafka.title]);
  });

  it('Confluence still works if Jira is unreachable', async () => {
    const http: JiraHttp = { ...fakeJira().http, searchIssueProperties: async () => { throw new Error('403'); } };
    const csvc = createDecisionService({ repo: new FederatedRepo(new MemoryRepo(), http) });
    expect(await csvc.list()).toEqual([]);
  });

  it('issue panel view backfills the mirror', async () => {
    const jira = fakeJira();
    const local = new MemoryRepo();
    await createDecisionService({ repo: local }).create({ ...kafka, links: [{ type: 'jira-issue', id: 'ACME-1' }] });
    const mirror = new MirroringRepo(local, jira.http);
    const h = buildHandlers(createDecisionService({ repo: mirror }), { onContextView: (t) => mirror.syncIssues([t.id]) });
    await h.listForContext(undefined, { extension: { issue: { key: 'ACME-1' } } });
    expect(jira.props.get('ACME-1')?.count).toBe(1);
  });

  it('merge dedupes by id, newest wins', () => {
    const a: any = { id: 'x', updatedAt: '2026-01-01' }, b: any = { id: 'x', updatedAt: '2026-02-01' };
    expect(merge([a], [b])).toEqual([b]);
  });
});
