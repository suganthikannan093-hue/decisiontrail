import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createDecisionService } from '../src/domain/decisions';
import { MemoryRepo } from '../src/storage/memoryRepo';

// Forge custom entities reject (422) any attribute not declared in manifest.yml.
const manifest = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'));
const attrs = (name: string) =>
  Object.keys(manifest.app.storage.entities.find((e: any) => e.name === name).attributes);

describe('manifest entity schema', () => {
  it('declares every attribute a stored Decision can have', async () => {
    const svc = createDecisionService({ repo: new MemoryRepo() } as any);
    const d: any = await svc.create({
      title: 'Use Kafka for order events',
      rationale: 'Need replay and high throughput; RabbitMQ lacks log retention',
      options: ['Kafka', 'RabbitMQ', 'SQS'],
      status: 'accepted',
      links: [{ type: 'jira-issue', id: 'ACME-1' }],
    });
    const declared = new Set(attrs('decision'));
    for (const k of [...Object.keys(d), 'supersedes', 'supersededBy']) expect(declared, k).toContain(k);
  });
  it('declares link row attributes', () => {
    expect(attrs('decisionlink').sort()).toEqual(['decisionId', 'target']);
  });
});
