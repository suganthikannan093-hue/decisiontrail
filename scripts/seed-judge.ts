/**
 * Judge / demo seed: sets up the fictional Acme scenario on YOUR OWN test site.
 *   - Jira: project ACME (team-managed Kanban) with issue "Choose message queue for order events"
 *     and the six-comment Kafka vs RabbitMQ debate
 *   - Confluence: page "Order events architecture" in the first space you can write to
 * Decisions themselves live in Forge storage, so load them in-app: open the issue's Decisions panel
 * and click "Load Acme demo decisions".
 *
 * Usage (Node 22+):
 *   SITE=https://<your-site>.atlassian.net ATL_EMAIL=you@example.com ATL_TOKEN=<api token> \
 *     node --experimental-strip-types scripts/seed-judge.ts [--dry-run]
 * Idempotent: existing project, issue, comments and page are reused. Never prints the token.
 */
import { DEMO_THREAD } from './demo-thread.ts';

const site = (process.env.SITE ?? '').replace(/\/$/, '');
const email = process.env.ATL_EMAIL, token = process.env.ATL_TOKEN;
const dry = process.argv.includes('--dry-run');
if (!site || !email || !token) { console.error('Set SITE, ATL_EMAIL and ATL_TOKEN (create a token at id.atlassian.com/manage-profile/security/api-tokens)'); process.exit(1); }
const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' };
const KEY = process.env.PROJECT ?? 'ACME';
const SUMMARY = 'Choose message queue for order events';
const PAGE = 'Order events architecture';

async function call(method: string, path: string, body?: unknown, okStatus = [200, 201, 204]) {
  if (dry && method !== 'GET') { console.log(`[dry-run] ${method} ${path}`); return {}; }
  const r = await fetch(`${site}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!okStatus.includes(r.status)) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? {} : r.json();
}
const textOf = (n: any): string => (n?.text ?? '') + (n?.content ?? []).map(textOf).join('');

const me: any = await call('GET', '/rest/api/3/myself');
// 1. project
const proj = await fetch(`${site}/rest/api/3/project/${KEY}`, { headers });
if (proj.status === 404) {
  await call('POST', '/rest/api/3/project', {
    key: KEY, name: 'Acme Checkout', leadAccountId: me.accountId, projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic', assigneeType: 'UNASSIGNED',
  });
  console.log(`created project ${KEY}`);
} else console.log(`project ${KEY} exists`);

// 2. issue
const found: any = await call('POST', '/rest/api/3/search/jql', { jql: `project = ${KEY} AND summary ~ "\\"${SUMMARY}\\""`, fields: ['summary'], maxResults: 1 });
let issueKey: string = found.issues?.[0]?.key;
if (!issueKey) {
  const meta: any = dry ? { values: [{ id: 'Task', name: 'Task' }] } : await call('GET', `/rest/api/3/issue/createmeta/${KEY}/issuetypes`);
  const type = meta.values?.find((t: any) => /task/i.test(t.name)) ?? meta.values?.[0];
  const created: any = await call('POST', '/rest/api/3/issue', { fields: { project: { key: KEY }, summary: SUMMARY, issuetype: { id: type?.id } } });
  issueKey = created.key ?? `${KEY}-?`;
  console.log(`created issue ${issueKey}`);
} else console.log(`issue ${issueKey} exists`);

// 3. comments
const have = new Set<string>();
if (!dry || found.issues?.length) for (const c of ((await call('GET', `/rest/api/3/issue/${issueKey}/comment?maxResults=100`)) as any).comments ?? []) have.add(textOf(c.body).trim());
for (const c of DEMO_THREAD) {
  const text = `${c.author}: ${c.text}`;
  if (have.has(text)) continue;
  await call('POST', `/rest/api/3/issue/${issueKey}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
}
console.log(`comments ready on ${issueKey}`);

// 4. Confluence page
try {
  const existing: any = await call('GET', `/wiki/api/v2/pages?title=${encodeURIComponent(PAGE)}&limit=1`);
  if (existing.results?.length) console.log(`page exists: ${site}/wiki/pages/viewpage.action?pageId=${existing.results[0].id}`);
  else {
    const spaces: any = await call('GET', '/wiki/api/v2/spaces?limit=1&type=global');
    const spaceId = spaces.results?.[0]?.id;
    if (!spaceId) throw new Error('no Confluence space found; create one first');
    const body = `<p>Order events for the Acme checkout rewrite. Tracking issue: ${issueKey}.</p><p>Insert the <strong>Decision log</strong> macro below (type /Decision log).</p>`;
    const p: any = await call('POST', '/wiki/api/v2/pages', { spaceId, status: 'current', title: PAGE, body: { representation: 'storage', value: body } });
    console.log(`created page ${PAGE}${p.id ? `: ${site}/wiki/pages/viewpage.action?pageId=${p.id}` : ''}`);
  }
} catch (e) { console.warn(`Confluence step skipped: ${(e as Error).message}`); }

console.log(`\nNext: open ${site}/browse/${issueKey} -> Decisions panel -> "Load Acme demo decisions".`);
