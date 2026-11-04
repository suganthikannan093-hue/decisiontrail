import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/storage/memoryRepo';
import { restoreFromMirror, buildIssueProperty, JiraHttp } from '../src/jira/bridge';
import { createDecisionService } from '../src/domain/decisions';

describe('restore from mirrored issue properties', () => {
  it('imports missing decisions once and never overwrites', async () => {
    const src = createDecisionService({ repo: new MemoryRepo() });
    const d = await src.create({ title: 'Use Kafka for order events', status: 'accepted', options: [], rationale: 'replay', links: [{ type: 'jira-issue', id: 'ACME-1' }] } as any, 'u1');
    const http: JiraHttp = { setIssueProperty: async () => {}, deleteIssueProperty: async () => {}, searchIssueProperties: async () => [buildIssueProperty([d])] };
    const repo = new MemoryRepo();
    expect(await restoreFromMirror(repo, http, async (x) => ({ ...x, sources: ['jira:ACME-1#1'] }))).toBe(1);
    expect((await repo.get(d.id))!.sources).toEqual(['jira:ACME-1#1']);
    expect(await restoreFromMirror(repo, http)).toBe(0);
  });
});
