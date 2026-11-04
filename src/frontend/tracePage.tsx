import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Badge, Box, Heading, Inline, Link, Lozenge, SectionMessage, Stack, Text, Textfield, Button } from '@forge/react';
import { invoke } from '@forge/bridge';
import { StatusLozenge } from './DecisionList';

interface Node { id: string; kind: 'decision' | 'issue' | 'page'; label: string; status?: string; date?: string }
interface Edge { from: string; to: string; kind: 'affects' | 'documented-in' | 'supersedes' }
interface Graph { nodes: Node[]; edges: Edge[]; lineages: { chain: { id: string; title: string; status: string; date: string }[] }[]; stats: Record<string, number> }
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

const href = (n: Node) => {
  const id = n.id.slice(n.id.indexOf(':') + 1);
  return n.kind === 'issue' ? `/browse/${id}` : `/wiki/pages/viewpage.action?pageId=${id}`;
};
const card = { borderColor: 'color.border', borderWidth: 'border.width', borderStyle: 'solid', borderRadius: 'radius.medium' } as const;

/** F5: decision -> issues -> pages -> superseding decisions (Jira project page and Confluence global page). */
const App = () => {
  const [g, setG] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [project, setProject] = useState<string | undefined>(undefined);
  const load = (p?: string) => invoke<Res<Graph>>('traceGraph', p ? { project: p } : {}).then((r) => (r.ok ? setG(r.data) : setError(r.error)));
  useEffect(() => { load(); }, []);
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  if (!g) return <Text>Building trace graph…</Text>;
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const decisions = g.nodes.filter((n) => n.kind === 'decision' && (!q || n.label.toLowerCase().includes(q.toLowerCase())));
  const out = (id: string, kind: Edge['kind']) => g.edges.filter((e) => e.from === id && e.kind === kind).map((e) => nodes.get(e.to)!).filter(Boolean);
  const inc = (id: string) => g.edges.filter((e) => e.to === id && e.kind === 'supersedes').map((e) => nodes.get(e.from)!).filter(Boolean);
  return (
    <Stack space="space.300">
      <Inline space="space.200" alignBlock="center">
        <Heading size="medium">Decision trace</Heading>
        <Lozenge>{g.stats.decisions} decisions</Lozenge><Lozenge>{g.stats.issues} issues</Lozenge>
        <Lozenge>{g.stats.pages} pages</Lozenge><Lozenge appearance="moved">{g.stats.superseded} superseded</Lozenge>
        {g.stats.orphaned > 0 && <Lozenge appearance="removed">{g.stats.orphaned} unlinked</Lozenge>}
      </Inline>
      <Inline space="space.100">
        <Textfield placeholder="Filter decisions" value={q} onChange={(e) => setQ(e.target.value)} />
        {project === undefined
          ? <Button appearance="subtle" onClick={() => { setProject(''); load(''); }}>Show all projects</Button>
          : null}
      </Inline>
      {g.stats.decisions === 0 && (
        <SectionMessage appearance="information" title="No decisions yet">
          <Text>Add one from a Jira issue's Decisions panel, or ask the DecisionTrail Capture agent to extract them from a comment thread. They will appear here linked to their issues, pages and the decisions they replace.</Text>
        </SectionMessage>
      )}
      {g.lineages.length > 0 && (
        <Stack space="space.100">
          <Heading size="small">Reversals</Heading>
          {g.lineages.map((l) => (
            <Inline key={l.chain[0].id} space="space.100" alignBlock="center" shouldWrap>
              {l.chain.map((c, i) => (
                <Inline key={c.id} space="space.050" alignBlock="center">
                  {i > 0 && <Text>→</Text>}<StatusLozenge status={c.status} /><Text>{c.title} ({c.date})</Text>
                </Inline>
              ))}
            </Inline>
          ))}
        </Stack>
      )}
      {decisions.map((d) => {
        const issues = out(d.id, 'affects'), pages = out(d.id, 'documented-in'), sup = out(d.id, 'supersedes'), by = inc(d.id);
        return (
          <Box key={d.id} padding="space.150" xcss={card}>
            <Stack space="space.075">
              <Inline space="space.100" alignBlock="center"><StatusLozenge status={d.status ?? ''} /><Text weight="bold">{d.label}</Text><Text size="small">{d.date} · {d.id.slice(9)}</Text></Inline>
              <Inline space="space.100" shouldWrap><Text>Issues <Badge>{issues.length}</Badge></Text>{issues.map((n) => <Link key={n.id} href={href(n)} openNewTab>{n.label}</Link>)}</Inline>
              <Inline space="space.100" shouldWrap><Text>Pages <Badge>{pages.length}</Badge></Text>{pages.map((n) => <Link key={n.id} href={href(n)} openNewTab>{n.label}</Link>)}</Inline>
              {sup.map((n) => <Text key={n.id}>Supersedes: {n.label}</Text>)}
              {by.map((n) => <Text key={n.id}>Superseded by: {n.label}</Text>)}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
};
ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
