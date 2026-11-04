import { describe, expect, it } from 'vitest';
import { buildRemoteLinks, staleLinks, LINK_PREFIX } from '../src/domain/links';
import { healthReport, toAdrMarkdown } from '../src/domain/health';
import { createDecisionService } from '../src/domain/decisions';
import { MemoryRepo } from '../src/storage/memoryRepo';
import { buildHandlers } from '../src/resolvers/handlers';
import { MirroringRepo, JiraHttp } from '../src/jira/bridge';
import { DEMO_DECISIONS } from '../src/domain/demo';

const issueCtx = { accountId: 'u1', extension: { issue: { key: 'ACME-1' } } };

async function demo() {
  const svc = createDecisionService({ repo: new MemoryRepo() });
  const h = buildHandlers(svc, { baseUrl: async () => 'https://acme.atlassian.net' });
  const r: any = await h.seedDemo(undefined, issueCtx);
  return { svc, h, r };
}

describe('onboarding demo seed', () => {
  it('creates the Acme chain once, linked to the issue', async () => {
    const { svc, h, r } = await demo();
    expect(r.data.created).toBe(DEMO_DECISIONS.length);
    expect(((await h.seedDemo(undefined, issueCtx)) as any).data.created).toBe(0);
    const ds = await svc.forTarget({ type: 'jira-issue', id: 'ACME-1' });
    const rabbit = ds.find((d) => d.title.includes('RabbitMQ'))!, kafka = ds.find((d) => d.title.includes('Kafka'))!;
    expect(kafka.supersedes).toBe(rabbit.id);
    expect(rabbit.status).toBe('superseded');
    expect(ds.find((d) => d.title.includes('Avro'))!.decidedBy).toBeFalsy();
  });
  it('refuses outside a Jira issue', async () => {
    const h = buildHandlers(createDecisionService({ repo: new MemoryRepo() }));
    expect(((await h.seedDemo(undefined, { extension: { content: { id: '1' } } })) as any).ok).toBe(false);
  });
});

describe('F8 health + ADR export', () => {
  it('reports owner gaps, stale proposals and reversals', async () => {
    const { svc } = await demo();
    const ds = await svc.list({});
    const soon = healthReport(ds, new Date());
    expect(soon).toMatchObject({ total: 3, reversals: 1, unlinked: [], stale: [] });
    expect(soon.noOwner.map((d) => d.title)).toEqual(['Use Avro with a schema registry for event payloads']);
    expect(soon.churn).toEqual([{ title: 'Use Kafka for order events', count: 1 }]);
    expect(healthReport(ds, new Date(Date.now() + 15 * 86_400_000)).stale).toHaveLength(1);
  });
  it('exports numbered ADRs with supersession and absolute links', async () => {
    const { h } = await demo();
    const r: any = await h.exportAdr(undefined, issueCtx);
    const md: string = r.data.markdown;
    const num = (t: string) => md.match(new RegExp(`## (ADR-\\d{4}): ${t}`))![1];
    const rabbit = num('Use RabbitMQ'), kafka = num('Use Kafka');
    expect(rabbit < kafka).toBe(true);
    expect(md).toContain(`- **Status:** Superseded (superseded by ${kafka})`);
    expect(md).toContain(`- **Supersedes:** ${rabbit}`);
    expect(md).toContain('[ACME-1](https://acme.atlassian.net/browse/ACME-1)');
    expect(md).toContain('- **Deciders:** unassigned');
  });
  it('handles an empty log', () => {
    expect(toAdrMarkdown([])).toContain('0 decision(s)');
    expect(healthReport([]).total).toBe(0);
  });
});

describe('F7 work links', () => {
  it('one remote link per documenting page, preferring the live decision', async () => {
    const { svc } = await demo();
    const ds = await svc.list({});
    for (const d of ds) await svc.link(d.id, { type: 'confluence-page', id: '360449' });
    const links = buildRemoteLinks(await svc.list({}), 'https://acme.atlassian.net/');
    expect(links).toHaveLength(1);
    expect(links[0].globalId).toBe(`${LINK_PREFIX}page:360449`);
    expect(links[0].object.url).toBe('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=360449');
    expect(links[0].object.title).toMatch(/^Use (Kafka|Avro).*\(\+2 more decisions\)$/);
    expect(links[0].object.summary!.length).toBeLessThanOrEqual(255);
  });
  it('only removes our own stale links', () => {
    expect(staleLinks([{ globalId: 'decisiontrail:page:1' }, { globalId: 'decisiontrail:page:2' }, { globalId: 'other:x' }, {}],
      [{ globalId: 'decisiontrail:page:2' } as any])).toEqual(['decisiontrail:page:1']);
  });
  it('mirror syncs links but a link failure never blocks saving', async () => {
    const calls: string[] = [];
    const http: JiraHttp = {
      setIssueProperty: async (k) => { calls.push(`prop:${k}`); }, deleteIssueProperty: async () => {}, searchIssueProperties: async () => [],
      syncRemoteLinks: async (k) => { calls.push(`links:${k}`); throw new Error('403'); },
    };
    const svc = createDecisionService({ repo: new MirroringRepo(new MemoryRepo(), http) });
    const d = await svc.create({ title: 'Use Kafka', links: [{ type: 'jira-issue', id: 'ACME-1' }] });
    expect(d.id).toBeTruthy();
    expect(calls).toEqual(['prop:ACME-1', 'links:ACME-1']);
  });
});
