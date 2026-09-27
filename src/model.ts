export const scenarios = {
  transient: {
    name: 'A little turbulence',
    subtitle: 'Temporary failure',
    description:
      'The receiver returns 503 twice, then recovers. Watch retries wait a little longer each time.',
    failures: 2,
  },
  outage: {
    name: 'The receiver is away',
    subtitle: 'Exhausted retries',
    description:
      'All three attempts fail. Restore the receiver and replay the same operation without losing its story.',
    failures: 3,
  },
  acknowledgement: {
    name: 'Did it go through?',
    subtitle: 'Lost acknowledgement',
    description:
      'The delivery is recorded, but its acknowledgement is lost. A retry checks the receipt before doing it again.',
    failures: 1,
  },
} as const;
export type Scenario = keyof typeof scenarios;
export type RunData = {
  sandbox: string;
  operationId: string;
  scenario: Scenario;
  restored: boolean;
  parentId?: string;
};
export type TimelineEvent = {
  id: string;
  at: number;
  kind: 'queued' | 'started' | 'failed' | 'committed' | 'deduplicated' | 'completed';
  title: string;
  detail: string;
  attempt: number;
};
export type Receipt = { id: string; operationId: string; createdAt: number; title: string };
export type Run = {
  id: string;
  operationId: string;
  scenario: Scenario;
  restored: boolean;
  parentId?: string;
  state: string;
  attemptsMade: number;
  attemptsStarted: number;
  maxAttempts: number;
  createdAt: number;
  finishedAt?: number;
  failedReason?: string;
  events: TimelineEvent[];
  receipt: Receipt | null;
};
export type Snapshot = {
  runs: Run[];
  workerOnline: boolean;
  storeOnline: boolean;
  serverTime: number;
  capacity: number;
  expiresAt: number;
};
export const labels: Record<string, string> = {
  waiting: 'Queued',
  active: 'Running',
  delayed: 'Retry scheduled',
  completed: 'Delivered',
  failed: 'Needs attention',
  paused: 'Queued',
  unknown: 'Checking',
};
export function failureFor(data: RunData, attempt: number): 'before' | 'after' | null {
  if (data.restored) return null;
  if (data.scenario === 'acknowledgement') return attempt === 1 ? 'after' : null;
  return attempt <= scenarios[data.scenario].failures ? 'before' : null;
}
export function retryDelay(failedAttempt: number, base = 1500) {
  return base * 2 ** (failedAttempt - 1);
}
