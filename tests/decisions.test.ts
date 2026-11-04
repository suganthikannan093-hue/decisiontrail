import { describe, expect, it } from 'vitest';
import { createDecisionService, normalizeInput, sortDecisions, ValidationError } from '../src/domain/decisions';
import { MemoryRepo } from '../src/storage/memoryRepo';
import { buildHandlers } from '../src/resolvers/handlers';
import { findDecisionsWith, saveDecisionWith } from '../src/rovo/actions';

const fixedNow = () => new Date('2026-11-05T10:00:00Z');
let n = 0;
const svcFactory = () => createDecisionService({ repo: new MemoryRepo(), now: fixedNow, newId: () => `dec-${++n}` });
const issue = { type: 'jira-issue' as const, id: 'ACME-1' };

describe('normalizeInput', () => {
  it('applies defaults and trims', () => {
    const d = normalizeInput({ title: '  Use Postgres ', options: [' a ', '', 'b'] }, fixedNow());
    expect(d).toMatchObject({ title: 'Use Postgres', status: 'proposed', date: '2026-11-05', options: ['a', 'b'] });
  });
  it('rejects short titles, bad status, bad dates, bad links', () => {
    expect(() => normalizeInput({ title: 'x' }, fixedNow())).toThrow(ValidationError);
    expect(() => normalizeInput({ title: 'ok title', status: 'nope' as never }, fixedNow())).toThrow(/status/);
    expect(() => normalizeInput({ title: 'ok title', date: '5/11/26' }, fixedNow())).toThrow(/Date/);
    expect(() => normalizeInput({ title: 'ok title', links: [{ type: 'jira-issue', id: 'bad' }] }, fixedNow())).toThrow(/link/);
  });
  it('uppercases and dedupes links', () => {
    const d = normalizeInput({ title: 'ok title', links: [{ type: 'jira-issue', id: 'acme-1' }, issue, { type: 'confluence-page', id: '42' }] }, fixedNow());
    expect(d.links).toEqual([issue, { type: 'confluence-page', id: '42' }]);
  });
});

describe('decision service', () => {
  it('creates, reads, updates and deletes', async () => {
    const s = svcFactory();
    const d = await s.create({ title: 'Use Kafka', links: [issue] }, 'acc-1');
    expect(d.decidedBy).toBe('acc-1');
    expect(await s.forTarget(issue)).toHaveLength(1);
    const u = await s.update(d.id, { status: 'accepted' });
    expect(u.status).toBe('accepted');
    await s.remove(d.id);
    expect(await s.get(d.id)).toBeUndefined();
  });
  it('supersedes an earlier decision', async () => {
    const s = svcFactory();
    const old = await s.create({ title: 'Use Kafka', status: 'accepted' });
    const nw = await s.create({ title: 'Use Postgres queue', supersedes: old.id });
    const o = await s.get(old.id);
    expect(o).toMatchObject({ status: 'superseded', supersededBy: nw.id });
    await expect(s.create({ title: 'ghost', supersedes: 'missing' })).rejects.toThrow(/not found/);
  });
  it('links and unlinks targets', async () => {
    const s = svcFactory();
    const d = await s.create({ title: 'Use Kafka' });
    await s.link(d.id, issue);
    await s.link(d.id, issue);
    expect((await s.get(d.id))!.links).toHaveLength(1);
    await s.unlink(d.id, issue);
    expect(await s.forTarget(issue)).toHaveLength(0);
  });
  it('filters and sorts list', async () => {
    const s = svcFactory();
    await s.create({ title: 'Old accepted', status: 'accepted', date: '2026-01-01' });
    await s.create({ title: 'New proposed', date: '2026-10-01', rationale: 'latency' });
    await s.create({ title: 'New accepted', status: 'accepted', date: '2026-10-01' });
    expect((await s.list()).map((d) => d.title)).toEqual(['New accepted', 'Old accepted', 'New proposed']);
    expect(await s.list({ status: 'proposed' })).toHaveLength(1);
    expect((await s.list({ query: 'LATENCY' }))[0].title).toBe('New proposed');
    expect(sortDecisions([])).toEqual([]);
  });
});

describe('resolver handlers', () => {
  it('links new decisions to the issue in context and reports validation errors', async () => {
    const h = buildHandlers(svcFactory());
    const ctx = { accountId: 'acc-9', extension: { issue: { key: 'ACME-1' } } };
    const r = await h.createDecision({ decision: { title: 'Adopt ADRs' } }, ctx);
    expect(r.ok && r.data.links).toEqual([issue]);
    const l = await h.listForContext({}, ctx);
    expect(l.ok && l.data.decisions).toHaveLength(1);
    const bad = await h.createDecision({ decision: { title: '' } }, ctx);
    expect(bad).toEqual({ ok: false, error: 'Title must be 3-200 characters' });
    const page = await h.listForContext({}, { extension: { content: { id: 77 } } });
    expect(page.ok && page.data.target).toEqual({ type: 'confluence-page', id: '77' });
  });
});

describe('rovo actions', () => {
  it('saves from flat inputs and finds by issue', async () => {
    const s = svcFactory();
    const msg = await saveDecisionWith(s, { title: 'Use Postgres', options: 'Postgres, Mongo', context: { jira: { issueKey: 'ACME-1' } } }, 'acc');
    expect(msg).toMatch(/Saved decision "Use Postgres".*ACME-1/);
    expect(await findDecisionsWith(s, { issueKey: 'ACME-1' })).toMatch(/\[proposed\] Use Postgres/);
    expect(await findDecisionsWith(s, { query: 'nothing' })).toBe('No matching decisions found.');
    expect(await saveDecisionWith(s, { title: 'x' })).toMatch(/Could not save/);
  });
});
