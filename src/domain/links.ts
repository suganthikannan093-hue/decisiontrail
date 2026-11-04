import { Decision } from './types';

/**
 * F7: decision -> work links. Every Confluence page that documents a decision on an issue becomes a
 * Jira remote link on that issue ("Mentioned in" / "Decision record"). Jira feeds remote links into
 * Teamwork Graph, so the issue <-> page relation is visible to Atlassian search, Rovo and the graph.
 * Global ids are deterministic so syncing is idempotent and stale links can be removed.
 */
export const LINK_PREFIX = 'decisiontrail:';
export interface RemoteLink { globalId: string; relationship: string; object: { url: string; title: string; summary?: string; icon?: { url16x16: string; title: string } } }

const ICON = { url16x16: 'https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg', title: 'DecisionTrail' };

export function buildRemoteLinks(ds: Decision[], base: string): RemoteLink[] {
  const byPage = new Map<string, Decision[]>();
  for (const d of ds) for (const l of d.links) if (l.type === 'confluence-page') byPage.set(l.id, [...(byPage.get(l.id) ?? []), d]);
  return [...byPage.entries()].map(([pageId, list]) => {
    const live = list.filter((d) => d.status !== 'superseded' && d.status !== 'rejected');
    const main = (live.length ? live : list)[0];
    return {
      globalId: `${LINK_PREFIX}page:${pageId}`,
      relationship: 'Decision record',
      object: {
        url: `${base.replace(/\/$/, '')}/wiki/pages/viewpage.action?pageId=${pageId}`,
        title: list.length > 1 ? `${main.title} (+${list.length - 1} more decisions)` : main.title,
        summary: list.map((d) => `[${d.status}] ${d.title}`).join('; ').slice(0, 255),
        icon: ICON,
      },
    };
  });
}

/** Which existing app-owned links to delete (ours, but no longer wanted). */
export function staleLinks(existing: { globalId?: string }[], wanted: RemoteLink[]): string[] {
  const keep = new Set(wanted.map((w) => w.globalId));
  return existing.map((e) => e.globalId ?? '').filter((g) => g.startsWith(LINK_PREFIX) && !keep.has(g));
}
