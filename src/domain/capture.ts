/**
 * F1 Decision capture: turn a comment thread into candidate decisions.
 * The heuristic gives Rovo a structured, cited starting point; the Rovo agent
 * refines it, and nothing is saved until the user confirms (saveDecision).
 */
export interface SourceComment {
  ref: string; // e.g. "jira:ACME-1#10001"
  author: string;
  created: string; // ISO timestamp
  text: string;
}

export interface CandidateDecision {
  title: string;
  chosen: string;
  options: string[];
  rationale: string;
  owner: string;
  date: string;
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
}

/** Plain text from Atlassian Document Format (Jira comment bodies). */
export function adfToText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text ?? '';
  const inner = (node.content ?? []).map(adfToText).join('');
  return ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(node.type) ? inner + '\n' : inner;
}

/** Plain text from Confluence storage-format XHTML. */
export const storageToText = (html: string) =>
  (html ?? '').replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

const DECIDE = /\b(we(?:'ve| have)? (?:decided|agreed|chose|chosen|picked|settled on|are going with|will go with|will use)|let'?s go with|decision\s*[:\-]|agreed\s*[:\-]|final call\s*[:\-]?|going with|we(?:'ll| will) use)\s+(.+)/i;
const REASON = /\b(because|since|as|due to|so that|given that)\b\s+(.+)/i;
const VERSUS = /\b([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*)?)\s+(?:vs\.?|versus|or)\s+([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*)?)/g;
const OPTION_LIST = /\boptions?\s*(?:are|were|:)\s*([^.!?\n]+)/i;

const clean = (s: string) => s.replace(/[.!?;,\s]+$/, '').trim();

function chosenFrom(clause: string): string {
  const m = clause.match(/^(?:to use\s+|using\s+|on\s+)?([A-Z][\w.+-]*(?:\s[A-Z][\w.+-]*)?)/);
  return m ? m[1] : clean(clause.split(/\b(?:because|since|for|as|due)\b/i)[0]).slice(0, 60);
}

export function collectOptions(texts: string[]): string[] {
  const out = new Map<string, string>();
  const add = (o: string) => { const c = clean(o.split(/[.!?]\s/)[0]); if (c && c.length <= 40) out.set(c.toLowerCase(), c); };
  for (const t of texts) {
    for (const m of t.matchAll(VERSUS)) { add(m[1]); add(m[2]); }
    const l = t.match(OPTION_LIST);
    if (l) l[1].split(/,|\bor\b|\band\b|\//).forEach(add);
  }
  return [...out.values()].slice(0, 10);
}

export function extractCandidates(comments: SourceComment[], subject = ''): CandidateDecision[] {
  const sorted = [...comments].sort((a, b) => a.created.localeCompare(b.created));
  const options = collectOptions([subject, ...sorted.map((c) => c.text)]);
  const out: CandidateDecision[] = [];
  for (const c of sorted) {
    for (const line of c.text.split(/\n|(?<=[.!?])\s+/)) {
      const m = line.match(DECIDE);
      if (!m) continue;
      const chosen = chosenFrom(m[2]);
      if (!chosen) continue;
      const reasonHere = line.match(REASON)?.[2];
      // supporting rationale from other comments that mention the chosen option with a reason
      const support = sorted.filter((o) => o !== c && o.text.toLowerCase().includes(chosen.toLowerCase()) && REASON.test(o.text));
      const rationale = [reasonHere, ...support.map((o) => o.text.match(REASON)?.[2])].filter(Boolean).map((r) => clean(r!)).join('; ');
      const opts = options.some((o) => o.toLowerCase() === chosen.toLowerCase()) ? options : [chosen, ...options];
      out.push({
        title: `Use ${chosen}${subject ? ` for ${subjectTopic(subject)}` : ''}`.slice(0, 200),
        chosen,
        options: opts,
        rationale,
        owner: speaker(c),
        date: c.created.slice(0, 10),
        confidence: rationale && opts.length > 1 ? 'high' : rationale || opts.length > 1 ? 'medium' : 'low',
        sources: [c.ref, ...support.map((o) => o.ref)],
      });
    }
  }
  // latest statement about the same choice wins
  const byChosen = new Map<string, CandidateDecision>();
  for (const d of out) byChosen.set(d.chosen.toLowerCase(), d);
  return [...byChosen.values()];
}

function subjectTopic(subject: string) {
  const m = subject.match(/\bfor\s+(.+)$/i);
  return clean(m ? m[1] : subject).toLowerCase().slice(0, 80);
}

/** Text the Rovo agent receives: thread + heuristic candidates, all with citation refs. */
export function formatExtraction(target: string, comments: SourceComment[], cands: CandidateDecision[]): string {
  if (!comments.length) return `No comments found on ${target}. Ask the user to describe the decision instead.`;
  const thread = comments.map((c) => `[${c.ref}] ${c.author} (${c.created.slice(0, 10)}): ${c.text.trim().slice(0, 1500)}`).join('\n');
  const cs = cands.length
    ? cands.map((d, i) => `${i + 1}. ${d.title} | chosen: ${d.chosen} | options: ${d.options.join(', ') || '-'} | rationale: ${d.rationale || '-'} | owner: ${d.owner} | date: ${d.date} | confidence: ${d.confidence} | sources: ${d.sources.join(' ')}`).join('\n')
    : 'none detected by the heuristic; infer from the thread';
  return `Comment thread on ${target} (${comments.length} comments):\n${thread}\n\nCandidate decisions:\n${cs}\n\nPropose each decision to the user and save only the ones they confirm, passing sources.`;
}

/** Seeded/pasted comments often start "Name (Team): ..."; prefer that speaker over the poster. */
export function speaker(c: SourceComment): string {
  const m = c.text.match(/^\s*([A-Z][\w'-]*(?:\s[A-Z][\w'-]*)?(?:\s\([^)]{1,30}\))?):\s/);
  return m ? m[1] : c.author;
}
