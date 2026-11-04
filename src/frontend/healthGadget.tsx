import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, CodeBlock, Heading, Inline, Lozenge, SectionMessage, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

type Item = { id: string; title: string; status: string; date: string };
interface Health { total: number; byStatus: Record<string, number>; noOwner: Item[]; stale: Item[]; unlinked: Item[]; reversals: number; churn: { title: string; count: number }[] }
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

const List = ({ title, items, hint }: { title: string; items: Item[]; hint: string }) => (
  <Stack space="space.050">
    <Inline space="space.100" alignBlock="center"><Text weight="bold">{title}</Text><Lozenge appearance={items.length ? 'moved' : 'success'}>{items.length}</Lozenge></Inline>
    {items.length ? items.slice(0, 5).map((d) => <Text key={d.id}>• {d.title} ({d.date})</Text>) : <Text size="small">{hint}</Text>}
  </Stack>
);

/** F8: decision health dashboard gadget, with ADR markdown export. */
const App = () => {
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => { invoke<Res<Health>>('decisionHealth').then((r) => (r.ok ? setH(r.data) : setError(r.error))); }, []);
  const exportAdr = async () => {
    const r = await invoke<Res<{ markdown: string }>>('exportAdr');
    if (r.ok) setMd(r.data.markdown); else setError(r.error);
  };
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  if (!h) return <Text>Checking decision health…</Text>;
  if (!h.total) return (
    <SectionMessage appearance="discovery" title="No decisions yet">
      <Text>Open any Jira issue, find the Decisions panel and click "Load Acme demo decisions" (or add your own). This gadget then shows unowned, stale and reversed decisions, and exports them as ADR markdown.</Text>
    </SectionMessage>
  );
  return (
    <Stack space="space.200">
      <Inline space="space.100" shouldWrap>
        <Lozenge>{h.total} decisions</Lozenge>
        <Lozenge appearance="success">{h.byStatus.accepted ?? 0} accepted</Lozenge>
        <Lozenge appearance="inprogress">{h.byStatus.proposed ?? 0} proposed</Lozenge>
        <Lozenge appearance="moved">{h.reversals} reversals</Lozenge>
      </Inline>
      <List title="No owner" items={h.noOwner} hint="Every decision has an owner." />
      <List title="Stale proposals (14+ days)" items={h.stale} hint="No proposals waiting too long." />
      <List title="Not linked to work" items={h.unlinked} hint="All decisions are linked to issues or pages." />
      {h.churn.length > 0 && (
        <Stack space="space.050">
          <Heading size="xsmall">Most reversed</Heading>
          {h.churn.map((c) => <Text key={c.title}>{c.title}: {c.count} reversal(s)</Text>)}
        </Stack>
      )}
      <Inline space="space.100">
        <Button onClick={exportAdr}>Export as ADR markdown</Button>
        {md && <Button appearance="subtle" onClick={() => setMd(null)}>Hide</Button>}
      </Inline>
      {md && <><Text size="small">Copy into docs/adr/ in your repo:</Text><CodeBlock language="markdown" text={md} /></>}
    </Stack>
  );
};
ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
