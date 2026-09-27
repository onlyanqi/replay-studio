import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { Queue, type Job } from 'bullmq';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { connection, prefix, key, ttl, capacity, origin, backoff } from './config';
import { event } from './engine';
import type { RunData, Run, Receipt, TimelineEvent } from '../src/model';
export function makeApp() {
  const redis = connection();
  const queueRedis = connection();
  const queue = new Queue<RunData>('deliveries', { connection: queueRedis, prefix });
  queue.on('error', () => {});
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', async (_req, res) => {
    try {
      await redis.ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: 'Queue storage is unavailable.' });
    }
  });
  app.use('/api', async (req, res, next) => {
    try {
      if (req.method !== 'GET' && req.headers.origin !== origin) {
        res.status(403).json({ error: 'Request origin is not allowed.' });
        return;
      }
      let token = req.cookies['replay-session'];
      let sandbox =
        typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
          ? createHash('sha256').update(token).digest('hex')
          : null;
      if (!sandbox || !(await redis.exists(key('session', sandbox)))) {
        if (req.method !== 'GET') {
          res
            .status(401)
            .json({ error: 'Your demo session expired. Refresh the page to start again.' });
          return;
        }
        const ipHash = createHash('sha256')
          .update(req.ip || 'unknown')
          .digest('hex');
        const rate = await redis.incr(key('sessions-per-hour', ipHash));
        if (rate === 1) await redis.expire(key('sessions-per-hour', ipHash), 3600);
        if (rate > 100) {
          res.status(429).json({ error: 'Too many new sessions. Please try again later.' });
          return;
        }
        token = randomBytes(32).toString('hex');
        sandbox = createHash('sha256').update(token).digest('hex');
        await redis.set(key('session', sandbox), String(Date.now() + ttl * 1000), 'EX', ttl);
        res.cookie('replay-session', token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: ttl * 1000,
          path: '/',
        });
      }
      res.locals.sandbox = sandbox;
      next();
    } catch {
      res
        .status(503)
        .json({ error: 'The queue store is unavailable. Start Valkey, then try again.' });
    }
  });
  async function ownedJob(id: string, sandbox: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !(await redis.zscore(key('runs', sandbox), id))) return null;
    const job = await queue.getJob(id);
    return job?.data.sandbox === sandbox ? job : null;
  }
  async function view(job: Job<RunData>): Promise<Run> {
    const [state, events, receipt] = await Promise.all([
      job.getState(),
      redis.lrange(key('events', job.id!), 0, -1),
      redis.hget(key('receipts', job.data.sandbox), job.data.operationId),
    ]);
    return {
      id: job.id!,
      operationId: job.data.operationId,
      scenario: job.data.scenario,
      restored: job.data.restored,
      parentId: job.data.parentId,
      state,
      attemptsMade: job.attemptsMade,
      attemptsStarted: job.attemptsStarted,
      maxAttempts: job.opts.attempts || 3,
      createdAt: job.timestamp,
      finishedAt: job.finishedOn,
      failedReason: job.failedReason,
      events: events.map((e) => JSON.parse(e) as TimelineEvent),
      receipt: receipt ? (JSON.parse(receipt) as Receipt) : null,
    };
  }
  app.get('/api/state', async (_req, res) => {
    const sandbox = res.locals.sandbox as string;
    const ids = await redis.zrevrange(key('runs', sandbox), 0, capacity - 1);
    const jobs = (await Promise.all(ids.map((id) => ownedJob(id, sandbox)))).filter(
      (j): j is Job<RunData> => !!j,
    );
    // SCAN avoids blocking the store as the number of workers grows.
    let cursor = '0',
      online = false;
    do {
      const result = await redis.scan(cursor, 'MATCH', key('worker', '*'), 'COUNT', 100);
      cursor = result[0];
      if (result[1].length) {
        online = true;
        break;
      }
    } while (cursor !== '0');
    res.json({
      runs: await Promise.all(jobs.map(view)),
      workerOnline: online,
      storeOnline: true,
      serverTime: Date.now(),
      capacity,
      expiresAt: Number(await redis.get(key('session', sandbox))),
    });
  });
  const submission = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('create'),
      scenario: z.enum(['transient', 'outage', 'acknowledgement']),
    }),
    z.object({ type: z.literal('replay'), runId: z.uuid() }),
  ]);
  app.post('/api/runs', async (req, res) => {
    const parsed = submission.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Choose a valid scenario or run.' });
      return;
    }
    const sandbox = res.locals.sandbox as string;
    const rate = await redis.incr(key('requests', sandbox));
    if (rate === 1) await redis.expire(key('requests', sandbox), 60);
    if (rate > 30) {
      res.status(429).json({ error: 'Give the worker a moment. Try again in a minute.' });
      return;
    }
    const c = parsed.data;
    let data: RunData;
    if (c.type === 'replay') {
      const original = await ownedJob(c.runId, sandbox);
      if (!original) {
        res.status(404).json({ error: 'Run not found in your session.' });
        return;
      }
      const state = await original.getState();
      if (state !== 'completed' && state !== 'failed') {
        res.status(409).json({ error: 'Wait for this run to finish before replaying it.' });
        return;
      }
      data = { ...original.data, restored: true, parentId: original.id };
    } else data = { sandbox, operationId: randomUUID(), scenario: c.scenario, restored: false };
    const id = randomUUID();
    // Reserve a slot atomically so concurrent requests cannot exceed the sandbox limit.
    const reserved = await redis.eval(
      `if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[1]) then return 0 end redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]) redis.call('EXPIRE',KEYS[1],ARGV[4]) return 1`,
      1,
      key('runs', sandbox),
      capacity,
      Date.now(),
      id,
      ttl,
    );
    if (!reserved) {
      res
        .status(429)
        .json({ error: 'This session has reached its 30-run limit. It expires after 24 hours.' });
      return;
    }
    try {
      await event(redis, id, {
        kind: 'queued',
        title: data.parentId ? 'Replay queued' : 'Run queued',
        detail: data.parentId
          ? 'A new run keeps the original operation key. The controlled receiver is restored for this replay.'
          : 'The API accepted this job. A separate worker will pick it up.',
        attempt: 0,
      });
      await queue.add('campaign-delivery', data, {
        jobId: id,
        attempts: 3,
        backoff: { type: 'exponential', delay: backoff },
        removeOnComplete: { age: ttl },
        removeOnFail: { age: ttl },
      });
      res.status(201).json({ id });
    } catch (error) {
      // On an ambiguous queue response, preserve the reserved ID if the job exists.
      const existing = await queue.getJob(id).catch(() => undefined);
      if (existing) {
        res.status(201).json({ id });
        return;
      }
      await redis.zrem(key('runs', sandbox), id);
      throw error;
    }
  });
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error instanceof Error ? error.message : 'Request failed');
    res
      .status(503)
      .json({
        error:
          'The service could not complete this request. Check the queue connection and try again.',
      });
  });
  return {
    app,
    redis,
    queue,
    close: async () => {
      await queue.close();
      await queueRedis.quit();
      await redis.quit();
    },
  };
}
