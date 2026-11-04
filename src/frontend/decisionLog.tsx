import React from 'react';
import ForgeReconciler, { useConfig, Stack } from '@forge/react';
import { ContextDecisions, DecisionLog } from './DecisionList';

const App = () => {
  const config = useConfig() as { status?: string; scope?: string } | undefined;
  return config?.scope === 'page' ? <ContextDecisions /> : (
    <Stack space="space.200"><DecisionLog status={config?.status || undefined} /></Stack>
  );
};
ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
