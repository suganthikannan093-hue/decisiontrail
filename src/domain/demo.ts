import { DecisionInput } from './types';

/** Fictional Acme demo decisions used by the onboarding "Load demo" button and the judge guide. */
export const DEMO_DECISIONS: (DecisionInput & { ref: string; supersedesRef?: string; noOwner?: boolean; evidence: string[] })[] = [
  { ref: 'rabbit', title: 'Use RabbitMQ for order events', status: 'accepted', options: ['RabbitMQ', 'Kafka'],
    rationale: 'Team already operates RabbitMQ; lowest operational cost for the first checkout release.',
    evidence: ['RabbitMQ is simpler to run'] },
  { ref: 'kafka', supersedesRef: 'rabbit', title: 'Use Kafka for order events', status: 'accepted', options: ['Kafka', 'RabbitMQ', 'SQS'],
    rationale: 'Fraud needs to replay the last 7 days of events and peak load is 40k events/s; RabbitMQ lacks log retention and SQS cannot guarantee per-customer ordering across regions.',
    evidence: ['Kafka gives us replay', 'SQS is out since', 'Decision: Kafka for order events'] },
  { ref: 'avro', title: 'Use Avro with a schema registry for event payloads', status: 'proposed', options: ['Avro', 'Protobuf', 'JSON Schema'],
    rationale: 'Consumers are written in three languages and need compatible schema evolution.', noOwner: true,
    evidence: ['use Avro with a schema registry'] },
];

/** Map each demo decision's evidence snippets to the refs of matching comments in the thread. */
export function demoSources(evidence: string[], comments: { ref: string; text: string }[]): string[] {
  const refs = evidence.map((e) => comments.find((c) => c.text.toLowerCase().includes(e.toLowerCase()))?.ref).filter((r): r is string => !!r);
  return [...new Set(refs)];
}
