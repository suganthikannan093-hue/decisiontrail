import api, { route } from '@forge/api';
import { IssueProperty, JiraHttp, PROPERTY_KEY } from './bridge';

async function ok(r: { ok: boolean; status: number; text(): Promise<string> }, what: string) {
  if (!r.ok) throw new Error(`${what} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

export const forgeJiraHttp: JiraHttp = {
  async setIssueProperty(issueKey, value) {
    const r = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    await ok(r, 'set issue property');
  },
  async deleteIssueProperty(issueKey) {
    const r = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, { method: 'DELETE' });
    if (r.status !== 404) await ok(r, 'delete issue property');
  },
  async searchIssueProperties(jql) {
    // asUser: Confluence viewers only see decisions on issues they can see in Jira.
    const r = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql, fields: ['summary'], properties: [PROPERTY_KEY], maxResults: 100 }),
    });
    await ok(r, 'search issues');
    const body = (await r.json()) as { issues?: { properties?: Record<string, IssueProperty> }[] };
    return (body.issues ?? []).map((i) => i.properties?.[PROPERTY_KEY]).filter((p): p is IssueProperty => !!p);
  },
};
