/** Fictional Acme demo thread (Kafka vs RabbitMQ) used by tests and the seed script. */
export const DEMO_THREAD = [
  { author: 'Priya (Platform)', text: 'For order events the options are Kafka, RabbitMQ or SQS. We need to settle this before the checkout rewrite.' },
  { author: 'Marco (Payments)', text: 'RabbitMQ vs Kafka: RabbitMQ is simpler to run and we already know it.' },
  { author: 'Priya (Platform)', text: 'Kafka gives us replay because the log is retained, and fraud needs to re-read the last 7 days of events.' },
  { author: 'Lena (SRE)', text: 'SQS is out since we need ordering per customer and cross-region replay. Throughput forecast is 40k events/s at peak.' },
  { author: 'Marco (Payments)', text: 'Fair. Decision: Kafka for order events, because we need replay and high throughput; RabbitMQ lacks log retention. Owner is Priya.' },
  { author: 'Lena (SRE)', text: "We'll use Avro with a schema registry for the event payloads since consumers are in three languages." },
];
