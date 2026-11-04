import { describe, expect, it } from 'vitest';
import { createDecisionService } from '../src/domain/decisions';
import { MemoryRepo } from '../src/storage/memoryRepo';
import { buildHandlers } from '../src/resolvers/handlers';
import { DEMO_THREAD } from '../scripts/demo-thread';

const ctx = { accountId: 'u1', extension: { issue: { key: 'ACME-1' } } };
const comments = DEMO_THREAD.map((c, i) => ({ ref: `jira:ACME-1#${10000 + i}`, text: `${c.author}: ${c.text}` }));

describe('demo seed cites source comments', () => {
  it('attaches the matching comment refs to each decision', async () => {
    const svc = createDecisionService({ repo: new MemoryRepo() });
    const h = buildHandlers(svc, { issueComments: async () => comments });
    const r: any = await h.seedDemo(undefined, ctx);
    expect(r.data.cited).toBe(3);
    const ds = await svc.list({});
    const by = (t: string) => ds.find((d) => d.title.includes(t))!.sources;
    expect(by('Kafka')).toEqual(['jira:ACME-1#10002', 'jira:ACME-1#10003', 'jira:ACME-1#10004']);
    expect(by('RabbitMQ')).toEqual(['jira:ACME-1#10001']);
    expect(by('Avro')).toEqual(['jira:ACME-1#10005']);
  });
  it('backfills sources on decisions seeded before comments were cited', async () => {
    const svc = createDecisionService({ repo: new MemoryRepo() });
    await buildHandlers(svc, {}).seedDemo(undefined, ctx);
    expect((await svc.list({})).every((d) => !d.sources?.length)).toBe(true);
    const r: any = await buildHandlers(svc, { issueComments: async () => comments }).seedDemo(undefined, ctx);
    expect(r.data).toEqual({ created: 0, cited: 3 });
    expect((await svc.list({})).every((d) => d.sources!.length > 0)).toBe(true);
  });
});
