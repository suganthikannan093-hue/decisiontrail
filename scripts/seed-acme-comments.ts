/**
 * Seed the fictional Acme Kafka-vs-RabbitMQ debate as comments on a Jira issue.
 * Usage: SITE=https://<site>.atlassian.net ATL_EMAIL=... ATL_TOKEN=... ISSUE=ACME-1 \
 *        node --experimental-strip-types scripts/seed-acme-comments.ts
 * Idempotent: comments whose text already exists are skipped. Never prints the token.
 */
import { DEMO_THREAD } from './demo-thread.ts';

const site = process.env.SITE ?? 'https://decisiontrail.atlassian.net';
const issue = process.env.ISSUE ?? 'ACME-1';
const email = process.env.ATL_EMAIL ?? process.env.FORGE_EMAIL;
const token = process.env.ATL_TOKEN ?? process.env.FORGE_API_TOKEN;
if (!email || !token) throw new Error('Set ATL_EMAIL and ATL_TOKEN (an Atlassian API token)');
const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' };

const textOf = (n: any): string => (n?.text ?? '') + (n?.content ?? []).map(textOf).join('');
const existing = await fetch(`${site}/rest/api/3/issue/${issue}/comment?maxResults=100`, { headers });
if (!existing.ok) throw new Error(`read comments: ${existing.status}`);
const have = new Set(((await existing.json()) as any).comments.map((c: any) => textOf(c.body).trim()));

for (const c of DEMO_THREAD) {
  const text = `${c.author}: ${c.text}`;
  if (have.has(text)) { console.log('skip', text.slice(0, 50)); continue; }
  const body = { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } };
  const r = await fetch(`${site}/rest/api/3/issue/${issue}/comment`, { method: 'POST', headers, body: JSON.stringify(body) });
  console.log(r.ok ? 'added' : `failed ${r.status}`, text.slice(0, 50));
}
