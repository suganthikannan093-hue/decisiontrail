import { Decision } from './types';

/** F2 "Why?": rank decisions for a question and format a cited answer basis. */
const STOP = new Set('why did do does we our the a an is are was were to for of on in and or use using choose chose chosen pick picked go with what which how this that it'.split(' '));
export const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9.+-]*/g) ?? []).filter((t) => !STOP.has(t) && t.length > 1);

export function rankDecisions(question: string, ds: Decision[], limit = 3): Decision[] {
  const q = tokens(question);
  if (!q.length) return [];
  const scored = ds.map((d) => {
    const title = tokens(d.title), body = tokens(`${d.rationale} ${d.options.join(' ')} ${d.links.map((l) => l.id).join(' ')}`);
    let s = 0;
    for (const t of q) { if (title.includes(t)) s += 3; else if (body.includes(t)) s += 1; }
    if (d.status === 'accepted') s += 0.5;
    if (d.status === 'superseded' || d.status === 'rejected') s -= 0.5;
    return { d, s };
  });
  return scored.filter((x) => x.s >= 1).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.d);
}

export function citeLink(l: { type: string; id: string }, base?: string) {
  if (!base) return l.id;
  return l.type === 'jira-issue' ? `${base}/browse/${l.id}` : `${base}/wiki/pages/viewpage.action?pageId=${l.id}`;
}

export function formatExplanation(question: string, hits: Decision[], all: Decision[], base?: string): string {
  if (!hits.length) return `No recorded decision answers "${question}". Say so plainly; do not guess. Suggest capturing it with the DecisionTrail capture agent.`;
  const byId = new Map(all.map((d) => [d.id, d]));
  const parts = hits.map((d, i) => {
    const lines = [
      `[D${i + 1}] ${d.title} (id ${d.id}, ${d.status}, decided ${d.date}${d.decidedBy ? `, owner ${d.decidedBy}` : ''})`,
      `  Why: ${d.rationale || 'no rationale recorded'}`,
      `  Options considered: ${d.options.join(', ') || 'not recorded'}`,
      `  Linked work: ${d.links.map((l) => citeLink(l, base)).join(', ') || 'none'}`,
      `  Source comments: ${(d.sources ?? []).join(', ') || 'none recorded'}`,
    ];
    if (d.supersededBy) lines.push(`  NOTE: superseded by ${d.supersededBy}${byId.get(d.supersededBy) ? ` ("${byId.get(d.supersededBy)!.title}")` : ''}`);
    if (d.supersedes) lines.push(`  Replaces earlier decision ${d.supersedes}${byId.get(d.supersedes) ? ` ("${byId.get(d.supersedes)!.title}")` : ''}`);
    return lines.join('\n');
  });
  return `Decisions relevant to "${question}":\n${parts.join('\n')}\n\nAnswer in 2-4 sentences using only these facts, cite as [D1] with the decision id, and list the linked work and source comments.`;
}
