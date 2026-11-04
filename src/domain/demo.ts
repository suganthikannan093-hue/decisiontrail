import { DecisionInput } from './types';

/** Fictional Acme demo decisions used by the onboarding "Load demo" button and the judge guide. */
export const DEMO_DECISIONS: (DecisionInput & { ref: string; supersedesRef?: string; noOwner?: boolean })[] = [
  { ref: 'rabbit', title: 'Use RabbitMQ for order events', status: 'accepted', options: ['RabbitMQ', 'Kafka'],
    rationale: 'Team already operates RabbitMQ; lowest operational cost for the first checkout release.' },
  { ref: 'kafka', supersedesRef: 'rabbit', title: 'Use Kafka for order events', status: 'accepted', options: ['Kafka', 'RabbitMQ', 'SQS'],
    rationale: 'Fraud needs to replay the last 7 days of events and peak load is 40k events/s; RabbitMQ lacks log retention and SQS cannot guarantee per-customer ordering across regions.' },
  { ref: 'avro', title: 'Use Avro with a schema registry for event payloads', status: 'proposed', options: ['Avro', 'Protobuf', 'JSON Schema'],
    rationale: 'Consumers are written in three languages and need compatible schema evolution.', noOwner: true },
];
