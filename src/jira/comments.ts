import api, { route } from '@forge/api';
import { adfToText, SourceComment, storageToText } from '../domain/capture';

export interface Thread { subject: string; comments: SourceComment[] }

/** Read a Jira issue's summary, description and comments as the current user. */
export async function readIssueThread(issueKey: string): Promise<Thread> {
  const r = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,comment`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Jira issue ${issueKey}: ${r.status}`);
  const j: any = await r.json();
  const comments: SourceComment[] = (j.fields?.comment?.comments ?? []).map((c: any) => ({
    ref: `jira:${issueKey}#${c.id}`,
    author: c.author?.displayName ?? 'unknown',
    created: c.created ?? '',
    text: adfToText(c.body),
  }));
  const desc = adfToText(j.fields?.description);
  if (desc.trim()) comments.unshift({ ref: `jira:${issueKey}#description`, author: 'description', created: j.fields?.created ?? '', text: desc });
  return { subject: j.fields?.summary ?? issueKey, comments };
}

/** Read a Confluence page's title and footer comments as the current user. */
export async function readPageThread(pageId: string): Promise<Thread> {
  const p = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, { headers: { Accept: 'application/json' } });
  if (!p.ok) throw new Error(`Confluence page ${pageId}: ${p.status}`);
  const page: any = await p.json();
  const r = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/footer-comments?body-format=storage&limit=100`, { headers: { Accept: 'application/json' } });
  const j: any = r.ok ? await r.json() : { results: [] };
  return {
    subject: page.title ?? pageId,
    comments: (j.results ?? []).map((c: any) => ({
      ref: `confluence:${pageId}#${c.id}`,
      author: c.version?.authorId ?? 'unknown',
      created: c.version?.createdAt ?? '',
      text: storageToText(c.body?.storage?.value ?? ''),
    })),
  };
}

export async function jiraBaseUrl(): Promise<string | undefined> {
  try {
    const r = await api.asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } });
    return r.ok ? ((await r.json()) as any).baseUrl : undefined;
  } catch { return undefined; }
}
