import { Decision } from './types';

/** F5 traceability graph: decision -> issues -> pages -> superseding decisions. */
export type NodeKind = 'decision' | 'issue' | 'page';
export interface GraphNode { id: string; kind: NodeKind; label: string; status?: string; date?: string }
export interface GraphEdge { from: string; to: string; kind: 'affects' | 'documented-in' | 'supersedes' }
export interface Lineage { chain: { id: string; title: string; status: string; date: string }[] }
export interface TraceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lineages: Lineage[];
  stats: { decisions: number; issues: number; pages: number; superseded: number; orphaned: number };
}

export const nodeId = (kind: NodeKind, id: string) => `${kind}:${id}`;

export function buildGraph(ds: Decision[], labels: Record<string, string> = {}, filter: { project?: string } = {}): TraceGraph {
  let pool = ds;
  if (filter.project) {
    const p = filter.project.toUpperCase();
    const touched = new Set(ds.filter((d) => d.links.some((l) => l.type === 'jira-issue' && l.id.startsWith(`${p}-`))).map((d) => d.id));
    // keep whole supersession chains that touch the project
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of ds) {
        const rel = [d.supersedes, d.supersededBy].filter(Boolean) as string[];
        if (!touched.has(d.id) && rel.some((r) => touched.has(r))) { touched.add(d.id); grew = true; }
      }
    }
    pool = ds.filter((d) => touched.has(d.id));
  }
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const byId = new Map(pool.map((d) => [d.id, d]));
  for (const d of pool) {
    nodes.set(nodeId('decision', d.id), { id: nodeId('decision', d.id), kind: 'decision', label: d.title, status: d.status, date: d.date });
    for (const l of d.links) {
      const kind: NodeKind = l.type === 'jira-issue' ? 'issue' : 'page';
      const nid = nodeId(kind, l.id);
      if (!nodes.has(nid)) nodes.set(nid, { id: nid, kind, label: labels[nid] ? `${l.id} ${labels[nid]}` : kind === 'page' ? `Page ${l.id}` : l.id });
      edges.push({ from: nodeId('decision', d.id), to: nid, kind: kind === 'issue' ? 'affects' : 'documented-in' });
    }
    if (d.supersedes && byId.has(d.supersedes)) edges.push({ from: nodeId('decision', d.id), to: nodeId('decision', d.supersedes), kind: 'supersedes' });
  }
  // lineages: start at decisions nobody in the pool supersedes... i.e. roots with no `supersedes` in pool
  const lineages: Lineage[] = [];
  for (const d of pool) {
    if (d.supersedes && byId.has(d.supersedes)) continue;
    if (!d.supersededBy) continue;
    const chain: Lineage['chain'] = [];
    const seen = new Set<string>();
    let cur: Decision | undefined = d;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push({ id: cur.id, title: cur.title, status: cur.status, date: cur.date });
      cur = cur.supersededBy ? byId.get(cur.supersededBy) : undefined;
    }
    if (chain.length > 1) lineages.push({ chain });
  }
  const all = [...nodes.values()];
  return {
    nodes: all,
    edges,
    lineages,
    stats: {
      decisions: pool.length,
      issues: all.filter((n) => n.kind === 'issue').length,
      pages: all.filter((n) => n.kind === 'page').length,
      superseded: pool.filter((d) => d.status === 'superseded').length,
      orphaned: pool.filter((d) => d.links.length === 0).length,
    },
  };
}

export function hrefFor(n: GraphNode): string {
  const [kind, id] = [n.kind, n.id.slice(n.id.indexOf(':') + 1)];
  return kind === 'issue' ? `/browse/${id}` : kind === 'page' ? `/wiki/pages/viewpage.action?pageId=${id}` : '';
}
