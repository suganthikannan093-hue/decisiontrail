import React from 'react';
import ForgeReconciler, { Label, Select } from '@forge/react';

const Config = () => (
  <>
    <Label labelFor="scope">Show</Label>
    <Select id="scope" name="scope" options={[{ label: 'All decisions (log)', value: 'all' }, { label: 'Decisions linked to this page', value: 'page' }]} />
    <Label labelFor="status">Status filter</Label>
    <Select id="status" name="status" isClearable options={['proposed', 'accepted', 'superseded', 'rejected'].map((s) => ({ label: s, value: s }))} />
  </>
);
ForgeReconciler.addConfig(<Config />);
