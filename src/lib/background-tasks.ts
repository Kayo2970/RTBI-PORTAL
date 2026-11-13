'use client';

/**
 * Background task tracker — long jobs (sending emails, certificates, invites...) register here so their progress survives
 * leaving the page that started them. The job itself is just an async function in the browser, so it keeps running while the
 * person moves between modules; this store only remembers what is going on, and the tray in the dashboard shell shows it
 * at the bottom-left of the screen (src/components/background-task-tray.tsx).
 */
import { useSyncExternalStore } from 'react';

export type BackgroundTaskState = 'running' | 'done' | 'failed';

export interface BackgroundTask {
  id: string;
  label: string;
  /** Live status line, e.g. "12 sent, 1 failed". */
  detail?: string;
  done: number;
  /** 0 = unknown (an indeterminate bar). */
  total: number;
  state: BackgroundTaskState;
  /** Final outcome text once the task has finished. */
  message?: string;
  /** Some items failed, but the job as a whole completed. */
  warn?: boolean;
  startedAt: number;
  finishedAt?: number;
  cancel?: () => void;
  stopping?: boolean;
}

let tasks: BackgroundTask[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let counter = 0;

function emit(next: BackgroundTask[]) {
  tasks = next;
  listeners.forEach((l) => l());
}
function patch(id: string, change: Partial<BackgroundTask>) {
  emit(tasks.map((t) => (t.id === id ? { ...t, ...change } : t)));
}

export function dismissTask(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  emit(tasks.filter((t) => t.id !== id));
}

export interface TaskHandle {
  id: string;
  /** Report how far along it is; `detail` replaces the status line. */
  progress: (done: number, detail?: string, total?: number) => void;
  /** Completed. `warn` marks "finished, but some items failed". */
  finish: (message?: string, opts?: { warn?: boolean }) => void;
  /** The whole job failed. */
  fail: (message?: string) => void;
}

export function beginTask(opts: { label: string; total?: number; detail?: string; onCancel?: () => void }): TaskHandle {
  const id = `bg-${Date.now()}-${++counter}`;
  const task: BackgroundTask = { id, label: opts.label, detail: opts.detail, done: 0, total: opts.total || 0, state: 'running', startedAt: Date.now() };
  if (opts.onCancel) {
    task.cancel = () => {
      patch(id, { stopping: true, detail: 'Stopping after the current item…' });
      opts.onCancel?.();
    };
  }
  emit([...tasks, task]);
  const settle = (state: BackgroundTaskState, message: string | undefined, warn?: boolean) => {
    patch(id, { state, message, warn, finishedAt: Date.now(), cancel: undefined, stopping: false });
    // Finished jobs tidy themselves away; failures and warnings stay until dismissed.
    if (state === 'done' && !warn) timers.set(id, setTimeout(() => dismissTask(id), 12_000));
  };
  return {
    id,
    progress: (done, detail, total) => patch(id, { done, ...(detail !== undefined ? { detail } : {}), ...(total !== undefined ? { total } : {}) }),
    finish: (message, o) => settle('done', message, o?.warn),
    fail: (message) => settle('failed', message),
  };
}

/** Runs `job` as a tracked background task. Any thrown error marks the task failed and is rethrown to the caller. */
export async function runTask<T>(opts: { label: string; total?: number; onCancel?: () => void }, job: (task: TaskHandle) => Promise<T>, summarize?: (result: T) => { message?: string; warn?: boolean }): Promise<T> {
  const handle = beginTask(opts);
  try {
    const result = await job(handle);
    const s = summarize?.(result);
    handle.finish(s?.message, { warn: s?.warn });
    return result;
  } catch (err: any) {
    handle.fail(err?.message || 'Something went wrong.');
    throw err;
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => tasks;
const emptyServer: BackgroundTask[] = [];

export function useBackgroundTasks(): BackgroundTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => emptyServer);
}
