import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  FileCheck2,
  GitBranch,
  Inbox,
  Layers3,
  LoaderCircle,
  Play,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Unplug,
  X,
} from 'lucide-react';
import {
  scenarios,
  labels,
  type Scenario,
  type Snapshot,
  type Run,
  type TimelineEvent,
} from './model';
const time = (stamp: number) =>
  new Date(stamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function short(id: string) {
  return id.slice(0, 8);
}
function elapsed(run: Run, now: number) {
  const ms = Math.max(0, (run.finishedAt || now) - run.createdAt);
  return `${(ms / 1000).toFixed(1)}s`;
}
function Badge({ state }: { state: string }) {
  return (
    <span className={`badge ${state}`}>
      <span />
      {labels[state] || state}
    </span>
  );
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [scenario, setScenario] = useState<Scenario>('transient'),
    [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'studio' | 'runs' | 'guide'>('studio'),
    [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all');
  const [busy, setBusy] = useState(false),
    [connectionError, setConnectionError] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const r = await fetch('/api/state', { signal, cache: 'no-store' });
    const next = await r.json();
    if (!r.ok) throw new Error(next.error || 'Could not reach the queue.');
    setSnapshot(next);
    setConnectionError('');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted)
          setConnectionError(e instanceof Error ? e.message : 'Connection lost.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, document.hidden ? 5000 : 1000);
      }
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  const run = snapshot?.runs.find((r) => r.id === selected) || snapshot?.runs[0];
  const worker = !!snapshot?.workerOnline && !connectionError;
  const runs = snapshot?.runs || [];
  const displayed = runs.filter((r) => filter === 'all' || r.state === filter);
  const uniqueReceipts = new Set(runs.filter((r) => r.receipt).map((r) => r.operationId)).size;
  async function submit(body: unknown) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setSelected(result.id);
      setTab('studio');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue this run.');
    } finally {
      setBusy(false);
    }
  }
  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setNotice('Operation key copied.');
    } catch {
      setError('Copy the operation key from the technical details below.');
    }
  }
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        Skip to studio
      </a>
      <header className="masthead">
        <a href="/" className="brand">
          <span className="brand-icon">
            <RotateCcw size={22} />
          </span>
          replay studio<span className="brand-dot">.</span>
        </a>
        <div className="header-links">
          <a href="https://onlyanqi.github.io/portfolio/" target="_blank" rel="noreferrer">
            An experiment by Anqi <ArrowUpRight size={14} />
          </a>
          <a
            className="source-button"
            href="https://github.com/onlyanqi/replay-studio"
            target="_blank"
            rel="noreferrer"
          >
            View source <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="workspace-name">
            <span className="workspace-symbol">
              <Layers3 size={21} />
            </span>
            <div>
              <strong>The reliability lab</strong>
              <span>A safe place for things to fail</span>
            </div>
          </div>
          <nav aria-label="Workspace">
            {(
              [
                { id: 'studio', title: 'The studio', icon: Radio },
                { id: 'runs', title: 'Your runs', icon: Layers3 },
                { id: 'guide', title: 'Behind the scenes', icon: BookOpen },
              ] as const
            ).map((n) => (
              <button
                key={n.id}
                className={`nav-item ${tab === n.id ? 'active' : ''}`}
                onClick={() => setTab(n.id)}
                aria-current={tab === n.id ? 'page' : undefined}
              >
                <n.icon size={18} />
                {n.title}
                {n.id === 'runs' && <span className="nav-count">{runs.length}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="session-label">
              <ShieldCheck size={15} />
              Your own sandbox
            </span>
            <p>Only your runs appear here. Session access expires after 24 hours.</p>
            <span className={`worker-status ${worker ? 'online' : ''}`}>
              <i />
              {connectionError ? 'Connection lost' : worker ? 'Worker connected' : 'Worker offline'}
            </span>
            <p className="sidebar-tech">
              BullMQ + Valkey
              <br />A separate worker. Real retries.
            </p>
          </div>
        </aside>
        <main id="main">
          <div className="context-bar">
            <span>
              <span className="live-dot" />
              Interactive reliability lab
            </span>
            <span className="context-right">Controlled failures. Real recovery.</span>
          </div>
          <section className="page-heading">
            <div>
              <p className="eyebrow">A little resilience goes a long way.</p>
              <h1>
                {tab === 'guide'
                  ? 'Understand the journey.'
                  : tab === 'runs'
                    ? 'Every attempt\nhas a story.'
                    : 'A second chance,\nby design.'}
              </h1>
              <p className="intro">
                {tab === 'guide'
                  ? 'From a queued intention to a confirmed result. Here’s what happens along the way.'
                  : tab === 'runs'
                    ? 'Follow each run from its first attempt to recovery—or its next beginning.'
                    : 'Follow a background job through failure, patience, and a safe return.'}
              </p>
            </div>
            <div className="orbit-art" aria-hidden="true">
              <svg viewBox="0 0 225 170">
                <ellipse
                  cx="114"
                  cy="87"
                  rx="79"
                  ry="57"
                  stroke="#b9a6ca"
                  strokeDasharray="3 7"
                  fill="none"
                  transform="rotate(-15 114 87)"
                />
                <path d="M177 58c15 40-15 75-56 73" stroke="#a58eb8" strokeWidth="2" fill="none" />
                <path d="m130 124-11 7 12 5" stroke="#a58eb8" strokeWidth="2" fill="none" />
                <g transform="rotate(-10 94 78)">
                  <rect
                    x="62"
                    y="34"
                    width="65"
                    height="82"
                    rx="7"
                    fill="#e6dcef"
                    stroke="#b7a2c6"
                  />
                  <path d="M76 55h35m-35 11h35m-35 11h23" stroke="#aa91bb" strokeWidth="2" />
                </g>
                <circle cx="149" cy="98" r="26" fill="#e4eee7" stroke="#a2bdae" />
                <path
                  d="m138 98 7 7 16-17"
                  stroke="#6a927b"
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M175 24v12m-6-6h12M37 108v9m-4-4h8" stroke="#b69dbf" strokeWidth="2" />
              </svg>
            </div>
          </section>
          <div aria-live="polite" className="notices">
            {connectionError && (
              <div className="notice error">
                <Unplug size={17} />
                <span>{connectionError} Showing the last known state.</span>
                <button onClick={() => refresh().catch((e) => setConnectionError(e.message))}>
                  Reconnect
                </button>
              </div>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
                <button aria-label="Dismiss error" onClick={() => setError('')}>
                  <X size={15} />
                </button>
              </div>
            )}
            {notice && (
              <div className="notice">
                <Check size={16} />
                {notice}
                <button aria-label="Dismiss message" onClick={() => setNotice('')}>
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
          {tab === 'studio' && (
            <>
              <section className="scenario-section" aria-labelledby="scenario-heading">
                <div className="section-heading">
                  <h2 id="scenario-heading">Choose a small disruption.</h2>
                  <span>Three ways to understand resilience</span>
                </div>
                <div className="scenario-grid" role="radiogroup" aria-label="Failure scenario">
                  {(Object.entries(scenarios) as [Scenario, (typeof scenarios)[Scenario]][]).map(
                    ([id, s], index) => (
                      <button
                        key={id}
                        role="radio"
                        tabIndex={scenario === id ? 0 : -1}
                        onKeyDown={(e) => {
                          const keys = [
                            'ArrowLeft',
                            'ArrowRight',
                            'ArrowUp',
                            'ArrowDown',
                            'Home',
                            'End',
                          ];
                          if (!keys.includes(e.key)) return;
                          e.preventDefault();
                          const ids = Object.keys(scenarios) as Scenario[];
                          const next =
                            e.key === 'Home'
                              ? 0
                              : e.key === 'End'
                                ? 2
                                : (index +
                                    (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) +
                                    3) %
                                  3;
                          setScenario(ids[next]);
                          (
                            e.currentTarget.parentElement?.children[next] as HTMLButtonElement
                          )?.focus();
                        }}
                        aria-checked={scenario === id}
                        className={`scenario-card ${id} ${scenario === id ? 'chosen' : ''}`}
                        onClick={() => setScenario(id)}
                      >
                        <span className="scenario-top">
                          <span className="scenario-icon">
                            {index === 0 ? (
                              <Radio size={20} />
                            ) : index === 1 ? (
                              <Unplug size={20} />
                            ) : (
                              <Copy size={20} />
                            )}
                          </span>
                          <span className="choice-dot">
                            {scenario === id && <Check size={11} />}
                          </span>
                        </span>
                        <strong>{s.name}</strong>
                        <span className="scenario-subtitle">{s.subtitle}</span>
                      </button>
                    ),
                  )}
                </div>
                <div className="launch-row">
                  <p>{scenarios[scenario].description}</p>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      !snapshot ||
                      !!connectionError ||
                      runs.length >= (snapshot?.capacity || 30)
                    }
                    onClick={() => submit({ type: 'create', scenario })}
                  >
                    {busy ? <LoaderCircle size={15} className="spin" /> : <Play size={14} />}Run
                    this scenario
                  </button>
                </div>
                {snapshot && !worker && !connectionError && (
                  <p className="worker-warning">
                    <Clock3 size={14} />
                    The worker is offline. You can queue a run; it will wait until the worker
                    returns.
                  </p>
                )}
              </section>
              <section className="run-section">
                <div className="section-heading">
                  <h2>{run ? 'The journey, as it happens.' : 'From intention to delivery.'}</h2>
                  <span className={`live-indicator ${!connectionError ? 'connected' : ''}`}>
                    <i />
                    {connectionError ? 'Last known state' : 'Updates every second'}
                  </span>
                </div>
                <div className="work-grid">
                  <section className="journey-panel" aria-label="Run timeline">
                    {run ? (
                      <>
                        <div className="run-heading">
                          <div>
                            <span className="small-label">
                              {run.parentId ? 'Replay' : 'Original run'} / {short(run.id)}
                            </span>
                            <h3>{scenarios[run.scenario].name}</h3>
                          </div>
                          <Badge state={run.state} />
                        </div>
                        <Flow run={run} live={!connectionError && worker} />
                        <div className="timeline-caption">
                          <span>Event trail</span>
                          <span>{elapsed(run, snapshot!.serverTime)} elapsed</span>
                        </div>
                        <ol className="timeline">
                          {run.events.map((e) => (
                            <EventRow key={e.id} entry={e} />
                          ))}
                          {run.state === 'delayed' && (
                            <li className="waiting-event">
                              <Clock3 size={15} />
                              <span>Waiting before the next attempt…</span>
                            </li>
                          )}
                          {run.state === 'waiting' && (
                            <li className="waiting-event">
                              <Clock3 size={15} />
                              <span>
                                {worker
                                  ? 'A worker will pick this up shortly.'
                                  : 'Safely queued. Waiting for a worker.'}
                              </span>
                            </li>
                          )}
                        </ol>
                        {run.state === 'failed' && (
                          <div className="recovery-note">
                            <TriangleAlert size={18} />
                            <div>
                              <strong>The retry budget is spent.</strong>
                              <p>
                                The run stays here so you can inspect it. Restore the controlled
                                receiver and replay the same operation.
                              </p>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty-journey">
                        <div className="empty-route">
                          <span>
                            <Send size={24} />
                          </span>
                          <i />
                          <span>
                            <RotateCcw size={24} />
                          </span>
                          <i />
                          <span>
                            <FileCheck2 size={24} />
                          </span>
                        </div>
                        <h3>Good systems make room for failure.</h3>
                        <p>
                          Choose a scenario above. You’ll see actual worker events here as the job
                          moves through the queue.
                        </p>
                        <span className="empty-note">No run has started yet.</span>
                      </div>
                    )}
                  </section>
                  <aside className="receipt-panel" aria-label="Delivery receipt">
                    <div className="receipt-title">
                      <FileCheck2 size={19} />
                      <h3>The receipt</h3>
                    </div>
                    <p>
                      A retry is another attempt.
                      <br />
                      Every run of one operation shares this receipt.
                    </p>
                    <div className={`receipt-paper ${run?.receipt ? 'delivered' : ''}`}>
                      <div className="receipt-paper-top">
                        <span>Petal Studio</span>
                        <span>Delivery record</span>
                      </div>
                      <span className="receipt-count">{run?.receipt ? '01' : '—'}</span>
                      <span className="receipt-count-label">
                        {run?.receipt ? 'delivery recorded' : 'awaiting a delivery'}
                      </span>
                      <div className="receipt-divider" />
                      {run?.receipt ? (
                        <>
                          <span className="receipt-confirm">
                            <Check size={14} />
                            One operation, one receipt
                          </span>
                          <span className="receipt-id">#{short(run.receipt.id)}</span>
                          <span className="receipt-date">{time(run.receipt.createdAt)}</span>
                        </>
                      ) : (
                        <span className="receipt-pending">
                          The receipt appears only after the receiver records the operation.
                        </span>
                      )}
                    </div>
                    {run && (
                      <>
                        <div className="run-facts">
                          <div>
                            <span>Attempts started</span>
                            <strong>
                              {run.attemptsStarted} / {run.maxAttempts}
                            </strong>
                          </div>
                          <div>
                            <span>Retry strategy</span>
                            <strong>Exponential backoff</strong>
                          </div>
                          <div>
                            <span>Duplicate skipped</span>
                            <strong>
                              {run.events.some((e) => e.kind === 'deduplicated')
                                ? 'Yes'
                                : 'Not observed'}
                            </strong>
                          </div>
                        </div>
                        {(run.state === 'failed' || run.state === 'completed') && (
                          <button
                            className="button replay-button"
                            disabled={
                              busy || !!connectionError || runs.length >= (snapshot?.capacity || 30)
                            }
                            onClick={() => submit({ type: 'replay', runId: run.id })}
                          >
                            <RotateCcw size={15} />
                            {run.state === 'failed' ? 'Restore receiver & replay' : 'Replay safely'}
                            <ArrowRight size={14} />
                          </button>
                        )}
                        {run.parentId && (
                          <button
                            className="parent-link"
                            onClick={() => setSelected(run.parentId!)}
                          >
                            <GitBranch size={14} />
                            See the previous run
                          </button>
                        )}
                        <details className="technical-details">
                          <summary>Under the hood</summary>
                          <p>Operation key</p>
                          <code>{run.operationId}</code>
                          <button className="text-button" onClick={() => copy(run.operationId)}>
                            Copy key <Copy size={12} />
                          </button>
                          <p>Run ID</p>
                          <code>{run.id}</code>
                          <p>
                            Attempts are processed by BullMQ. Replays get a new run ID and keep the
                            same operation key.
                          </p>
                        </details>
                      </>
                    )}
                  </aside>
                </div>
              </section>
              {runs.length > 0 && (
                <section className="recent-runs">
                  <div className="section-heading">
                    <h2>Recent runs</h2>
                    <button className="text-button" onClick={() => setTab('runs')}>
                      See all {runs.length}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {runs.slice(0, 4).map((r) => (
                    <RunRow
                      key={r.id}
                      run={r}
                      selected={r.id === run?.id}
                      onSelect={() => setSelected(r.id)}
                    />
                  ))}
                </section>
              )}
            </>
          )}
          {tab === 'runs' && (
            <section className="all-runs">
              <div className="section-heading">
                <h2>Your session</h2>
                <span>
                  {uniqueReceipts} unique {uniqueReceipts === 1 ? 'delivery' : 'deliveries'} /{' '}
                  {runs.length} runs
                </span>
              </div>
              <div className="filters" aria-label="Filter runs">
                {(['all', 'completed', 'failed'] as const).map((f) => (
                  <button
                    key={f}
                    aria-pressed={filter === f}
                    className={filter === f ? 'active' : ''}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'All runs' : f === 'completed' ? 'Delivered' : 'Needs attention'}
                  </button>
                ))}
              </div>
              {displayed.length ? (
                displayed.map((r) => (
                  <RunRow
                    key={r.id}
                    run={r}
                    selected={false}
                    onSelect={() => {
                      setSelected(r.id);
                      setTab('studio');
                    }}
                  />
                ))
              ) : (
                <div className="empty-list">
                  <Inbox size={30} />
                  <h3>
                    {runs.length
                      ? 'No runs match this filter.'
                      : 'Your first run is waiting to happen.'}
                  </h3>
                  <p>Start a scenario in the studio to see its history here.</p>
                  <button className="button light" onClick={() => setTab('studio')}>
                    Open the studio
                  </button>
                </div>
              )}
            </section>
          )}
          {tab === 'guide' && (
            <section className="guide">
              <div className="guide-intro">
                <Sparkles size={25} />
                <p>
                  This lab makes reliability visible. The delivery receiver is a controlled example;
                  the queue and worker execute real jobs.
                </p>
              </div>
              <div className="guide-grid">
                {[
                  {
                    title: 'A queue holds the intention.',
                    icon: Inbox,
                    text: 'The API submits a job to BullMQ. Valkey stores it independently of the page and the worker. Close this tab: a running worker can still finish the job.',
                  },
                  {
                    title: 'A worker makes an attempt.',
                    icon: Play,
                    text: 'A separate Node process picks up the job. A controlled receiver returns a failure or writes a receipt. The timeline records the events as they happen.',
                  },
                  {
                    title: 'Patience has a budget.',
                    icon: Clock3,
                    text: 'A failed job gets up to three attempts. The first retry waits 1.5 seconds; the next waits 3 seconds. After that, the failed job is retained for manual recovery.',
                  },
                  {
                    title: 'A receipt prevents duplicates.',
                    icon: ShieldCheck,
                    text: 'The receiver checks and writes the operation’s receipt atomically in Valkey. Repeating the operation returns the existing receipt. This guarantee applies to this receiver’s record, not arbitrary external services.',
                  },
                ].map((item) => (
                  <article key={item.title}>
                    <item.icon size={23} />
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </article>
                ))}
              </div>
              <div className="guide-boundary">
                <h3>What replay changes—and what it keeps.</h3>
                <p>
                  Replay creates a new run with the controlled receiver restored. It keeps the
                  operation key, links back to the original run, and leaves its history intact.
                  Failed jobs are retained in BullMQ’s failed set; this version does not use a
                  separate dead-letter queue.
                </p>
                <p>
                  Data is a short-lived learning sandbox. Session access lasts 24 hours. Receipts
                  have a rolling 24-hour retention window, and expired jobs are cleaned up when
                  BullMQ finalizes later jobs. It is not a permanent audit archive.
                </p>
                <a
                  href="https://github.com/onlyanqi/replay-studio"
                  target="_blank"
                  rel="noreferrer"
                  className="text-button"
                >
                  Read the architecture and tests <ArrowUpRight size={14} />
                </a>
              </div>
            </section>
          )}
          <footer>
            <span>
              <ShieldCheck size={13} />
              Small failures. Useful lessons.
            </span>
            <span>Made with intention, by Anqi.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Flow({ run, live }: { run: Run; live: boolean }) {
  const active = live && (run.state === 'active' || run.state === 'delayed');
  return (
    <div
      className={`flow ${active ? 'moving' : ''}`}
      aria-label={`Job state: ${labels[run.state] || run.state}`}
    >
      <div className="flow-node">
        <span>
          <Inbox size={19} />
        </span>
        <small>Queue</small>
      </div>
      <i />
      <div className={`flow-node ${active ? 'current' : ''}`}>
        <span>
          <RotateCcw size={19} />
        </span>
        <small>Worker</small>
      </div>
      <i />
      <div className={`flow-node ${run.state === 'failed' ? 'blocked' : ''}`}>
        <span>
          <Send size={19} />
        </span>
        <small>Receiver</small>
      </div>
      <i />
      <div className={`flow-node ${run.receipt ? 'done' : ''}`}>
        <span>
          <FileCheck2 size={19} />
        </span>
        <small>Receipt</small>
      </div>
    </div>
  );
}
function EventRow({ entry }: { entry: TimelineEvent }) {
  return (
    <li className={`event ${entry.kind}`}>
      <span className="event-marker">
        {entry.kind === 'failed' ? (
          <X size={12} />
        ) : entry.kind === 'completed' || entry.kind === 'committed' ? (
          <Check size={12} />
        ) : entry.kind === 'deduplicated' ? (
          <ShieldCheck size={12} />
        ) : (
          <span />
        )}
      </span>
      <div>
        <div className="event-title">
          <strong>{entry.title}</strong>
          <time dateTime={new Date(entry.at).toISOString()}>{time(entry.at)}</time>
        </div>
        <p>{entry.detail}</p>
      </div>
    </li>
  );
}
function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: Run;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`run-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-label={`Open ${scenarios[run.scenario].name} run ${short(run.id)}`}
    >
      <span className={`run-symbol ${run.state}`}>
        {run.parentId ? <RotateCcw size={18} /> : <Send size={18} />}
      </span>
      <span className="run-row-name">
        <strong>{scenarios[run.scenario].name}</strong>
        <span>
          {run.parentId ? 'Replay' : 'Original'} · {short(run.id)} · {time(run.createdAt)}
        </span>
      </span>
      <Badge state={run.state} />
      <ChevronRight size={16} />
    </button>
  );
}
