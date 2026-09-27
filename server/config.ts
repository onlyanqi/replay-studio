import 'dotenv/config';
import { Redis } from 'ioredis';
export const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3001';
export const prefix = process.env.QUEUE_PREFIX || 'replay-studio';
if (!/^[a-zA-Z0-9_-]+$/.test(prefix))
  throw new Error('QUEUE_PREFIX must contain letters, numbers, underscores, or hyphens.');
export const ttl = 86400;
export const capacity = 30;
export const backoff = Number(process.env.RETRY_DELAY_MS || 1500);
export const stepDelay = Number(process.env.STEP_DELAY_MS || 700);
export const key = (...parts: string[]) => [prefix, ...parts].join(':');
export const redisURL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';
export function connection(worker = false) {
  const client = new Redis(redisURL, {
    maxRetriesPerRequest: worker ? null : 1,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 250, 2000),
  });
  client.on('error', () => {});
  return client;
}
