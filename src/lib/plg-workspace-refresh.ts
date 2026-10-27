export const PLG_STATUS_REFRESH_MS = 30_000;

/** Component-owned reads: cancelled or superseded responses never replace current state. */
export function createPlgWorkspaceReader<T>({ read, accept, reject }: {
  read: (signal: AbortSignal) => Promise<T>;
  accept: (value: T, checkedAt: number) => void;
  reject: (error: unknown) => void;
}) {
  let active = false;
  let generation = 0;
  let pending: { controller: AbortController; background: boolean } | null = null;
  const cancel = () => {
    generation++;
    pending?.controller.abort();
    pending = null;
  };
  return {
    activate() { active = true; },
    deactivate() { active = false; cancel(); },
    cancel,
    cancelBackground() { if (pending?.background) cancel(); },
    async refresh(background = false) {
      if (!active || (background && pending)) return;
      cancel();
      const owner = generation;
      const request = { controller: new AbortController(), background };
      pending = request;
      try {
        const value = await read(request.controller.signal);
        if (active && owner === generation && !request.controller.signal.aborted)
          accept(value, Date.now());
      } catch (error) {
        if (active && owner === generation && !request.controller.signal.aborted) reject(error);
      } finally {
        if (pending === request) pending = null;
      }
    },
  };
}

/** Schedule only visible, idle reads; never start overlapping background work. */
export function watchPlgWorkspaceStatus({ refresh, cancel, visible, idle, documentTarget, windowTarget }: {
  refresh: () => Promise<void>;
  cancel: () => void;
  visible: () => boolean;
  idle: () => boolean;
  documentTarget: EventTarget;
  windowTarget: EventTarget;
}) {
  let stopped = false;
  let running = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (!stopped && visible()) timer = setTimeout(() => { void refreshVisible(); }, PLG_STATUS_REFRESH_MS);
  };
  const refreshVisible = async () => {
    if (stopped || !visible()) return;
    if (running) return;
    clear();
    if (!idle()) { schedule(); return; }
    running = true;
    const owner = ++generation;
    try { await refresh(); }
    finally {
      if (owner === generation) { running = false; schedule(); }
    }
  };
  const visibilityChanged = () => {
    if (visible()) void refreshVisible();
    else { clear(); generation++; running = false; cancel(); }
  };
  const focus = () => { void refreshVisible(); };
  documentTarget.addEventListener('visibilitychange', visibilityChanged);
  windowTarget.addEventListener('focus', focus);
  void refreshVisible();
  return () => {
    if (stopped) return;
    stopped = true;
    generation++;
    clear();
    cancel();
    documentTarget.removeEventListener('visibilitychange', visibilityChanged);
    windowTarget.removeEventListener('focus', focus);
  };
}
