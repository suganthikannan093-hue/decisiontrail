import { Decision } from './types';

/** F8: decision health for the dashboard gadget. */
export interface Health {
  total: number;
  byStatus: Record<string, number>;
  noOwner: Decision[];
  stale: Decision[];   // proposed and untouched for `staleDays`
  unlinked: Decision[];
  reversals: number;   // decisions that supersede another
  churn: { title: string; count: number }[]; // longest supersession chains
}

const days = (a: string, b: Date) => (b.getTime() - new Date(a).getTime()) / 86_400_000;

export function healthReport(ds: Decision[], now = new Date(), staleDays = 14): Health {
  const byStatus: Record<string, number> = { proposed: 0, accepted: 0, superseded: 0, rejected: 0 };
  for (const d of ds) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  const byId = new Map(ds.map((d) => [d.id, d]));
  const chainLen = (d: Decision) => { let n = 0, c: Decision | undefined = d; const seen = new Set<string>(); while (c?.supersedes && !seen.has(c.id)) { seen.add(c.id); n++; c = byId.get(c.supersedes); } return n; };
  const heads = ds.filter((d) => !d.supersededBy && d.supersedes);
  return {
    total: ds.length,
    byStatus,
    noOwner: ds.filter((d) => !d.decidedBy && d.status !== 'superseded'),
    stale: ds.filter((d) => d.status === 'proposed' && days(d.updatedAt || d.createdAt, now) >= staleDays),
    unlinked: ds.filter((d) => !d.links.length),
    reversals: ds.filter((d) => d.supersedes).length,
    churn: heads.map((d) => ({ title: d.title, count: chainLen(d) })).sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

const esc = (s: string) => s.replace(/\r?\n/g, ' ').trim();

/** Export decisions as ADRs (Michael Nygard format), one section per decision, oldest first. */
export function toAdrMarkdown(ds: Decision[], opts: { owners?: Record<string, string>; base?: string } = {}): string {
  const byId = new Map(ds.map((d) => [d.id, d]));
  const depth = (d: Decision) => { let n = 0, c: Decision | undefined = d; const seen = new Set<string>(); while (c?.supersedes && !seen.has(c.id)) { seen.add(c.id); n++; c = byId.get(c.supersedes); } return n; };
  // oldest first; ties broken so a superseded decision precedes its replacement
  const sorted = [...ds].sort((a, b) => (a.createdAt || a.date).localeCompare(b.createdAt || b.date) || depth(a) - depth(b));
  const num = new Map(sorted.map((d, i) => [d.id, String(i + 1).padStart(4, '0')]));
  const ref = (id?: string) => (id && num.has(id) ? `ADR-${num.get(id)}` : id ?? '');
  const base = (opts.base ?? '').replace(/\/$/, '');
  const link = (l: Decision['links'][number]) => l.type === 'jira-issue' ? `[${l.id}](${base}/browse/${l.id})` : `[Confluence page ${l.id}](${base}/wiki/pages/viewpage.action?pageId=${l.id})`;
  const out = ['# Architecture Decision Records', '', `_Exported by DecisionTrail: ${sorted.length} decision(s)._`, ''];
  for (const d of sorted) {
    const status = d.status[0].toUpperCase() + d.status.slice(1);
    out.push(`## ADR-${num.get(d.id)}: ${esc(d.title)}`, '',
      `- **Status:** ${status}${d.supersededBy ? ` (superseded by ${ref(d.supersededBy)})` : ''}`,
      `- **Date:** ${d.date}`,
      `- **Deciders:** ${opts.owners?.[d.decidedBy] ?? (d.decidedBy || 'unassigned')}`);
    if (d.supersedes) out.push(`- **Supersedes:** ${ref(d.supersedes)}`);
    if (d.links.length) out.push(`- **Links:** ${d.links.map(link).join(', ')}`);
    out.push('', '### Context and options', '', d.options.length ? d.options.map((o) => `- ${esc(o)}`).join('\n') : '_No alternatives recorded._',
      '', '### Decision', '', esc(d.title) + '.', '', '### Rationale', '', d.rationale ? esc(d.rationale) : '_Not recorded._', '');
    if (d.sources?.length) out.push(`_Sources: ${d.sources.join(', ')}_`, '');
  }
  return out.join('\n');
}
