import { describe, expect, it } from 'vitest';
import { chosenOf, detectConflicts, GUARD_MARKER, MemoryConflictStore, notificationAdf, recordConflicts } from '../src/domain/conflict';
import { buildGraph } from '../src/domain/graph';
import { createDecisionService } from '../src/domain/decisions';
import { MemoryRepo } from '../src/storage/memoryRepo';
import { runGuard } from '../src/jira/guard';
import { buildHandlers } from '../src/resolvers/handlers';
import { isConfluence } from '../src/resolvers/index';

const OWNER = '712020:64a2936f-56ca-417f-9fd5-60e9a8df7c62';
async function kafkaSetup() {
  const repo = new MemoryRepo();
  const svc = createDecisionService({ repo });
  const k = await svc.create({ title: 'Use Kafka for order events', options: ['Kafka', 'RabbitMQ', 'SQS'], status: 'accepted', links: [{ type: 'jira-issue', id: 'ACME-1' }] }, OWNER);
  return { repo, svc, k };
}
const cmt = (text: string) => ({ ref: 'jira:ACME-1#10010', issueKey: 'ACME-1', author: 'Marco', text });

describe('F6 conflict detection', () => {
  it('derives the chosen option', async () => {
    const { k } = await kafkaSetup();
    expect(chosenOf(k)).toBe('Kafka');
  });
  it.each([
    "Ops is stretched; let's switch to RabbitMQ for order events.",
    'Honestly we should use RabbitMQ instead.',
    'Can we drop Kafka? The cluster costs too much.',
    'Proposal: migrate away from Kafka to SQS next quarter.',
  ])('flags: %s', async (text) => {
    const { k } = await kafkaSetup();
    const [c] = detectConflicts(cmt(text), [k]);
    expect(c?.decisionId).toBe(k.id);
    expect(c.ownerAccountId).toBe(OWNER);
  });
  it.each([
    'Kafka cluster is provisioned, RabbitMQ was ruled out.',
    'Remember we rejected SQS because of ordering.',
    `${GUARD_MARKER}: switch to RabbitMQ`,
  ])('ignores: %s', async (text) => {
    const { k } = await kafkaSetup();
    expect(detectConflicts(cmt(text), [k])).toEqual([]);
  });
  it('ignores non-accepted decisions', async () => {
    const { k } = await kafkaSetup();
    expect(detectConflicts(cmt("let's switch to RabbitMQ"), [{ ...k, status: 'proposed' }])).toEqual([]);
  });
  it('notification mentions the owner and names the decision', async () => {
    const { k } = await kafkaSetup();
    const adf = JSON.stringify(notificationAdf(detectConflicts(cmt("let's switch to RabbitMQ"), [k])[0]));
    expect(adf).toContain(OWNER);
    expect(adf).toContain(k.id);
    expect(adf).toContain(GUARD_MARKER);
  });
});

describe('F6 trigger + panel flow', () => {
  it('records once, notifies once, skips app comments, then supersedes', async () => {
    const { svc, k } = await kafkaSetup();
    const store = new MemoryConflictStore();
    const notified: string[] = [];
    const deps = {
      readComment: async (_: string, id: string) => (id === '99' ? { author: 'DecisionTrail', accountType: 'app', text: "let's switch to RabbitMQ" } : { author: 'Marco', text: "let's switch to RabbitMQ" }),
      acceptedDecisions: async () => [k],
      store,
      notify: async (_: string, c: any) => { notified.push(c.decisionId); },
    };
    const ev = { issue: { key: 'ACME-1' }, comment: { id: '10010' } };
    expect(await runGuard(deps, ev)).toHaveLength(1);
    expect(await runGuard(deps, ev)).toHaveLength(0); // duplicate event
    expect(await runGuard(deps, { issue: { key: 'ACME-1' }, comment: { id: '99' } })).toHaveLength(0);
    expect(notified).toEqual([k.id]);
    expect(await recordConflicts(store, 'ACME-1', [])).toEqual([]);

    const h = buildHandlers(svc, { conflicts: store });
    const ctx = { accountId: OWNER, extension: { issue: { key: 'ACME-1' } } };
    const list: any = await h.listConflicts(undefined, ctx);
    expect(list.data).toHaveLength(1);
    const r: any = await h.supersedeFromConflict({ commentRef: 'jira:ACME-1#10010', decisionId: k.id }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data.title).toBe('Use RabbitMQ for order events');
    expect(r.data.supersedes).toBe(k.id);
    expect(r.data.sources).toEqual(['jira:ACME-1#10010']);
    expect((await svc.get(k.id))!.status).toBe('superseded');
    expect(((await h.listConflicts(undefined, ctx)) as any).data).toHaveLength(0);
  });
  it('dismiss removes the flag', async () => {
    const { k } = await kafkaSetup();
    const store = new MemoryConflictStore();
    await recordConflicts(store, 'ACME-1', detectConflicts(cmt("let's switch to RabbitMQ"), [k]));
    const h = buildHandlers(createDecisionService({ repo: new MemoryRepo() }), { conflicts: store });
    const r: any = await h.dismissConflict({ commentRef: 'jira:ACME-1#10010', decisionId: k.id }, { extension: { issue: { key: 'ACME-1' } } });
    expect(r.data).toEqual([]);
  });
});

describe('F5 traceability graph', () => {
  async function seeded() {
    const svc = createDecisionService({ repo: new MemoryRepo() });
    const r = await svc.create({ title: 'Use RabbitMQ for order events', status: 'accepted', links: [{ type: 'jira-issue', id: 'ACME-1' }] });
    const k = await svc.create({ title: 'Use Kafka for order events', status: 'accepted', supersedes: r.id, links: [{ type: 'jira-issue', id: 'ACME-1' }, { type: 'confluence-page', id: '360449' }] });
    await svc.create({ title: 'Use Postgres for ledger', status: 'accepted', links: [{ type: 'jira-issue', id: 'PAY-2' }] });
    await svc.create({ title: 'Unlinked idea', status: 'proposed' });
    return { svc, r, k };
  }
  it('builds nodes, edges, lineage and stats', async () => {
    const { svc, r, k } = await seeded();
    const g = buildGraph(await svc.list(), { 'issue:ACME-1': 'Choose message queue' });
    expect(g.stats).toEqual({ decisions: 4, issues: 2, pages: 1, superseded: 1, orphaned: 1 });
    expect(g.edges).toContainEqual({ from: `decision:${k.id}`, to: `decision:${r.id}`, kind: 'supersedes' });
    expect(g.edges).toContainEqual({ from: `decision:${k.id}`, to: 'page:360449', kind: 'documented-in' });
    expect(g.nodes.find((n) => n.id === 'issue:ACME-1')!.label).toBe('ACME-1 Choose message queue');
    expect(g.lineages.map((l) => l.chain.map((c) => c.id))).toEqual([[r.id, k.id]]);
  });
  it('scopes to a project but keeps whole supersession chains', async () => {
    const { svc } = await seeded();
    const g = buildGraph(await svc.list(), {}, { project: 'ACME' });
    expect(g.stats.decisions).toBe(2);
    expect(g.nodes.some((n) => n.id === 'issue:PAY-2')).toBe(false);
  });
  it('traceGraph resolver uses project context and tolerates label failures', async () => {
    const { svc } = await seeded();
    const h = buildHandlers(svc, { labels: async () => { throw new Error('403'); } });
    const r: any = await h.traceGraph(undefined, { extension: { project: { key: 'PAY' } } });
    expect(r.ok).toBe(true);
    expect(r.data.stats.decisions).toBe(1);
  });
  it('routes Confluence global page to the Confluence handlers', () => {
    expect(isConfluence({ extension: { type: 'confluence:globalPage' } })).toBe(true);
    expect(isConfluence({ extension: { type: 'macro', content: { id: '1' } } })).toBe(true);
    expect(isConfluence({ extension: { type: 'jira:projectPage' } })).toBe(false);
  });
});
