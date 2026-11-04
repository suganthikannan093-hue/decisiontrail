import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import { Button, Inline, SectionMessage, Stack, Text } from '@forge/react';

interface Conflict { decisionId: string; decisionTitle: string; chosen: string; proposed: string; commentRef: string; author: string; excerpt: string; reason: string }
type Res<T> = { ok: true; data: T } | { ok: false; error: string };

/** F6: shows comments that contradict accepted decisions, with supersede / dismiss actions. */
export function ConflictBanner({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Conflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const r = await invoke<Res<Conflict[]>>('listConflicts');
    if (r.ok) setItems(r.data); else setError(r.error);
  };
  useEffect(() => { load(); }, []);
  const act = async (fn: 'dismissConflict' | 'supersedeFromConflict', c: Conflict) => {
    const r = await invoke<Res<unknown>>(fn, { commentRef: c.commentRef, decisionId: c.decisionId });
    if (!r.ok) return setError(r.error);
    setError(null); await load(); onChange();
  };
  if (!items.length && !error) return null;
  return (
    <Stack space="space.100">
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {items.map((c) => (
        <SectionMessage key={`${c.commentRef}|${c.decisionId}`} appearance="warning" title={`Possible reversal of "${c.decisionTitle}"`}>
          <Stack space="space.100">
            <Text>{c.author}'s comment {c.reason}: "{c.excerpt}"</Text>
            <Inline space="space.100">
              <Button appearance="warning" onClick={() => act('supersedeFromConflict', c)}>Record "{c.proposed}" as superseding decision</Button>
              <Button appearance="subtle" onClick={() => act('dismissConflict', c)}>Dismiss</Button>
            </Inline>
          </Stack>
        </SectionMessage>
      ))}
    </Stack>
  );
}
