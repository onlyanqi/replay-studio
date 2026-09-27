# Reliability model

## Two identities

A **run ID** identifies one queue submission. An **operation key** identifies the logical delivery. Automatic retries stay on the same run. Manual replay gets a fresh run ID, keeps the operation key, and records its parent.

## Three-attempt budget

The worker throws real `Error` instances for controlled failures. BullMQ schedules up to three attempts with exponential backoff: 1.5 seconds before retry one, then 3 seconds before retry two. A failed job is retained for investigation. The worker concurrency is two.

The receiver is restored only for the newly created manual replay. The original scenario and event trail remain unchanged. Replaying a completed run is also allowed; its existing receipt demonstrates duplicate prevention.

## Ambiguous success

In the lost-acknowledgement scenario:

1. The receiver atomically stores the receipt.
2. The worker reports a timeout instead of completion.
3. BullMQ retries.
4. The receiver returns the same receipt and skips the write.
5. The worker completes the job.

The duplicate check and receipt insertion use one Lua script. They are atomic across workers. This is an idempotent effect inside one store, not a distributed transaction with an external service. A replay of an old failed run may display a receipt produced by a later run of the same operation.

Receipt insertion and timeline logging are separate commands. A process failure between them may leave an incomplete event trail; the next attempt still checks the authoritative receipt. Timeline events are observability, not the source of truth for whether the operation occurred.

## Recovery and limits

Queue state persists independently of the worker. Queued work survives a graceful worker stop; a restart picks it up. BullMQ owns active-job locks and stalled-job recovery. The test suite covers queued work during a worker restart; it does not claim to test abrupt process death at every instruction or arbitrary network partitions.

Runs and receipts belong to a random visitor session; replay verifies both its index and job ownership. The API rejects cross-origin mutations and bounds payload size. New sessions and submissions are rate-limited in the store. The per-session capacity reservation is atomic.

If storage is unavailable, the UI shows a connection error and the last known state; it does not continue a pretend success animation. Worker presence comes from expiring heartbeat keys. Polling every second means the page may lag a transition by one second.

Sessions expire after 24 hours. Receipts/events and the run index have rolling TTLs; jobs use BullMQ's lazy age-based removal. Do not treat this as an immutable long-term ledger. Deployments must monitor abandoned queue metadata and storage growth.

## Verified behavior

- Controlled temporary failure succeeds on attempt three, with increasing delay.
- Persistent failure becomes terminal; a restored replay preserves lineage.
- Lost acknowledgement and repeated replay retain one receipt.
- Twenty concurrent attempts at the same effect create exactly one receipt.
- A different visitor cannot list or replay your runs.
- Invalid scenarios and foreign-origin writes are rejected.
- Queued work waits while the worker is stopped and completes after restart.
- Browser flows cover recovery, manual replay, keyboard scenario selection, and mobile layout.
