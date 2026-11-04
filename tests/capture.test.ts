import { describe, expect, it } from 'vitest';
import { adfToText, collectOptions, extractCandidates, formatExtraction, SourceComment, storageToText } from '../src/domain/capture';
import { formatExplanation, rankDecisions } from '../src/domain/explain';
import { createDecisionService } from '../src/domain/decisions';
import { MemoryRepo } from '../src/storage/memoryRepo';
import { explainWhyWith, extractDecisionsWith, saveDecisionWith } from '../src/rovo/actions';
import { DEMO_THREAD } from '../scripts/demo-thread';

const thread: SourceComment[] = DEMO_THREAD.map((c, i) => ({
  ref: `jira:ACME-1#${10001 + i}`, author: c.author, created: `2026-11-0${i + 1}T10:00:00.000+0000`, text: c.text,
}));
const subject = 'Choose message queue for order events';

describe('F1 capture: parsing', () => {
  it('flattens ADF and storage format', () => {
    const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'mention', attrs: { text: '@Priya' } }] }] };
    expect(adfToText(adf).trim()).toBe('Hello @Priya');
    expect(storageToText('<p>A &amp; B</p><p>C</p>')).toBe('A & B\nC');
  });
  it('collects options from "vs" and option lists', () => {
    expect(collectOptions(thread.map((c) => c.text))).toEqual(expect.arrayContaining(['Kafka', 'RabbitMQ', 'SQS']));
  });
});

describe('F1 capture: candidates', () => {
  const cands = extractCandidates(thread, subject);
  it('finds the Kafka decision with rationale, owner, date and sources', () => {
    const k = cands.find((c) => c.chosen === 'Kafka')!;
    expect(k).toBeTruthy();
    expect(k.title).toBe('Use Kafka for order events');
    expect(k.rationale).toMatch(/replay and high throughput/);
    expect(k.options).toEqual(expect.arrayContaining(['Kafka', 'RabbitMQ', 'SQS']));
    expect(k.owner).toBe('Marco (Payments)');
    expect(k.date).toBe('2026-11-05');
    expect(k.confidence).toBe('high');
    expect(k.sources[0]).toBe('jira:ACME-1#10005');
    expect(k.sources).toContain('jira:ACME-1#10003');
  });
  it('finds the second (Avro) decision', () => {
    expect(cands.map((c) => c.chosen)).toContain('Avro');
  });
  it('returns nothing for a thread without decisions', () => {
    expect(extractCandidates([{ ref: 'x', author: 'a', created: '2026-01-01', text: 'Should we look at Kafka?' }])).toEqual([]);
  });
  it('formats an agent-ready extraction with citations and an empty-thread message', () => {
    expect(formatExtraction('ACME-1', thread, cands)).toMatch(/\[jira:ACME-1#10005\]/);
    expect(formatExtraction('ACME-1', [], [])).toMatch(/No comments found/);
  });
});

describe('F1 action + save with sources', () => {
  it('extractDecisions uses issue context; saveDecision stores sources', async () => {
    const reader = { issue: async () => ({ subject, comments: thread }), page: async () => ({ subject: 'p', comments: [] }) };
    const out = await extractDecisionsWith(reader, { context: { jira: { issueKey: 'ACME-1' } } });
    expect(out).toMatch(/Use Kafka for order events/);
    expect(await extractDecisionsWith(reader, {})).toMatch(/No Jira issue or Confluence page/);
    const svc = createDecisionService({ repo: new MemoryRepo() });
    await saveDecisionWith(svc, { title: 'Use Kafka for order events', status: 'accepted', issueKey: 'ACME-1', sources: 'jira:ACME-1#10005 jira:ACME-1#10003' });
    const [d] = await svc.list();
    expect(d.sources).toEqual(['jira:ACME-1#10005', 'jira:ACME-1#10003']);
  });
});

describe('F2 explain why', () => {
  async function seeded() {
    const svc = createDecisionService({ repo: new MemoryRepo() });
    const rabbit = await svc.create({ title: 'Use RabbitMQ for order events', status: 'accepted', links: [{ type: 'jira-issue', id: 'ACME-1' }] });
    const kafka = await svc.create({
      title: 'Use Kafka for order events', rationale: 'Need replay and high throughput; RabbitMQ lacks log retention',
      options: ['Kafka', 'RabbitMQ', 'SQS'], status: 'accepted', supersedes: rabbit.id,
      links: [{ type: 'jira-issue', id: 'ACME-1' }, { type: 'confluence-page', id: '360449' }], sources: ['jira:ACME-1#10005'],
    });
    await svc.create({ title: 'Use Postgres for the ledger', rationale: 'ACID', status: 'accepted' });
    return { svc, kafka, rabbit };
  }
  it('ranks the matching accepted decision first', async () => {
    const { svc, kafka } = await seeded();
    expect(rankDecisions('Why are we on Kafka?', await svc.list())[0].id).toBe(kafka.id);
  });
  it('answers with citations, links and supersession', async () => {
    const { svc, kafka, rabbit } = await seeded();
    const out = await explainWhyWith(svc, { question: 'why did we choose Kafka for order events?' }, 'https://x.atlassian.net');
    expect(out).toContain(`id ${kafka.id}`);
    expect(out).toContain('https://x.atlassian.net/browse/ACME-1');
    expect(out).toContain('pageId=360449');
    expect(out).toContain('jira:ACME-1#10005');
    expect(out).toContain(`Replaces earlier decision ${rabbit.id}`);
  });
  it('says plainly when nothing is recorded', async () => {
    const { svc } = await seeded();
    expect(await explainWhyWith(svc, { question: 'why GraphQL?' })).toMatch(/No recorded decision/);
    expect(formatExplanation('q', [], [])).toMatch(/do not guess/);
  });
});
