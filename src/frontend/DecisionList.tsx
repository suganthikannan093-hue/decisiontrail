import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import {
  Badge, Box, Button, DynamicTable, Form, FormFooter, FormSection, Heading, Inline, Label, Lozenge,
  Select, SectionMessage, Stack, Text, TextArea, Textfield, useForm,
} from '@forge/react';

export interface Decision {
  id: string; title: string; rationale: string; options: string[]; status: string; date: string;
  links: { type: string; id: string }[]; supersedes?: string;
}
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

const APPEARANCE: Record<string, 'success' | 'inprogress' | 'removed' | 'default'> = {
  accepted: 'success', proposed: 'inprogress', superseded: 'default', rejected: 'removed',
};
export const StatusLozenge = ({ status }: { status: string }) => <Lozenge appearance={APPEARANCE[status] ?? 'default'}>{status}</Lozenge>;

/** Shared by the Jira issue panel and the Confluence page context. */
export function ContextDecisions({ allowAdd = true }: { allowAdd?: boolean }) {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [target, setTarget] = useState<{ type: string; id: string } | null>(null);
  const { handleSubmit, register, getFieldId } = useForm();

  const load = async () => {
    const r = await invoke<Res<{ decisions: Decision[] }>>('listForContext');
    if (r.ok) { setDecisions(r.data.decisions); setTarget((r.data as any).target ?? null); } else setError(r.error);
  };
  useEffect(() => { load(); }, []);

  const create = async (v: Record<string, any>) => {
    const r = await invoke<Res<Decision>>('createDecision', {
      decision: {
        title: v.title, rationale: v.rationale,
        options: String(v.options ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
        status: v.status?.value ?? 'proposed',
      },
    });
    if (!r.ok) return setError(r.error);
    setError(null); setAdding(false); load();
  };

  const seed = async () => {
    const r = await invoke<Res<{ created: number }>>('seedDemo');
    if (!r.ok) return setError(r.error);
    setError(null); load();
  };

  const linkExisting = async () => {
    const r = await invoke<Res<Decision>>('linkDecision', { id: linkId.trim() });
    if (!r.ok) return setError(r.error);
    setLinkId(''); load();
  };

  const setStatus = async (id: string, status: string) => {
    const r = await invoke<Res<Decision>>('updateDecision', { id, patch: { status } });
    if (!r.ok) setError(r.error); else load();
  };

  if (!decisions) return <Text>Loading decisions…</Text>;
  return (
    <Stack space="space.200">
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      <Inline space="space.100" alignBlock="center">
        <Heading size="small">Decisions</Heading><Badge>{decisions.length}</Badge>
      </Inline>
      {decisions.length === 0 && (
        <SectionMessage appearance="discovery" title="Capture why, not just what">
          <Stack space="space.100">
            <Text>No decisions recorded here yet. A decision records what was chosen, the options considered and why, linked to the issues and pages it affects.</Text>
            <Text>1. Use "Add decision" below, or ask the DecisionTrail Capture agent in Rovo Chat to extract decisions from this thread.</Text>
            <Text>2. Ask the DecisionTrail Why agent "why did we choose ...?" for a cited answer.</Text>
            <Text>3. If a later comment contradicts an accepted decision, the conflict guard flags it here.</Text>
            {target?.type === 'jira-issue' && <Button appearance="primary" onClick={seed}>Load Acme demo decisions</Button>}
          </Stack>
        </SectionMessage>
      )}
      {decisions.map((d) => (
        <Box key={d.id} padding="space.100" xcss={{ borderColor: 'color.border', borderWidth: 'border.width', borderStyle: 'solid', borderRadius: 'radius.medium' }}>
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="center"><StatusLozenge status={d.status} /><Text weight="bold">{d.title}</Text></Inline>
            {d.rationale && <Text>Why: {d.rationale}</Text>}
            {d.options.length > 0 && <Text>Options considered: {d.options.join(' · ')}</Text>}
            <Text size="small">{d.date} · {d.id}{d.supersedes ? ` · supersedes ${d.supersedes}` : ''}</Text>
            {d.status === 'proposed' && (
              <Inline space="space.100">
                <Button spacing="compact" onClick={() => setStatus(d.id, 'accepted')}>Accept</Button>
                <Button spacing="compact" appearance="subtle" onClick={() => setStatus(d.id, 'rejected')}>Reject</Button>
              </Inline>
            )}
          </Stack>
        </Box>
      ))}
      {allowAdd && !adding && (
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => setAdding(true)}>Add decision</Button>
          <Textfield placeholder="Existing decision id" value={linkId} onChange={(e) => setLinkId(e.target.value)} />
          <Button onClick={linkExisting} isDisabled={!linkId.trim()}>Link</Button>
        </Inline>
      )}
      {adding && (
        <Form onSubmit={handleSubmit(create)}>
          <FormSection>
            <Label labelFor={getFieldId('title')}>Decision</Label>
            <Textfield {...register('title', { required: true })} placeholder="We will use Postgres for the event store" />
            <Label labelFor={getFieldId('rationale')}>Why</Label>
            <TextArea {...register('rationale')} placeholder="Context, trade-offs and constraints" />
            <Label labelFor={getFieldId('options')}>Options considered (comma separated)</Label>
            <Textfield {...register('options')} />
            <Label labelFor={getFieldId('status')}>Status</Label>
            <Select {...register('status')} options={[{ label: 'Proposed', value: 'proposed' }, { label: 'Accepted', value: 'accepted' }]} />
          </FormSection>
          <FormFooter>
            <Button appearance="subtle" onClick={() => setAdding(false)}>Cancel</Button>
            <Button appearance="primary" type="submit">Save</Button>
          </FormFooter>
        </Form>
      )}
    </Stack>
  );
}

/** Space-wide decision log table (Confluence macro). */
export function DecisionLog({ status }: { status?: string }) {
  const [rows, setRows] = useState<Decision[] | null>(null);
  useEffect(() => {
    invoke<Res<Decision[]>>('listDecisions', { status }).then((r) => setRows(r.ok ? r.data : []));
  }, [status]);
  if (!rows) return <Text>Loading decision log…</Text>;
  return (
    <DynamicTable
      caption="Decision log"
      emptyView={<Text>No decisions yet. Record one from a Jira issue's Decisions panel (try "Load Acme demo decisions"), or add this macro with scope "This page" to capture decisions here.</Text>}
      head={{ cells: ['Status', 'Decision', 'Why', 'Date', 'Linked to'].map((c) => ({ key: c, content: c, isSortable: c !== 'Why' })) }}
      rows={rows.map((d) => ({
        key: d.id,
        cells: [
          { key: d.status, content: <StatusLozenge status={d.status} /> },
          { key: d.title, content: d.title },
          { key: 'why', content: d.rationale },
          { key: d.date, content: d.date },
          { key: 'links', content: d.links.map((l) => l.id).join(', ') },
        ],
      }))}
    />
  );
}
