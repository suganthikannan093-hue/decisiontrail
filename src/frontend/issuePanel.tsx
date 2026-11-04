import React, { useState } from 'react';
import ForgeReconciler, { Stack } from '@forge/react';
import { ContextDecisions } from './DecisionList';
import { ConflictBanner } from './ConflictBanner';

const App = () => {
  const [rev, setRev] = useState(0);
  return (
    <Stack space="space.200">
      <ConflictBanner onChange={() => setRev((r) => r + 1)} />
      <ContextDecisions key={rev} />
    </Stack>
  );
};
ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
