import { useEffect, useLayoutEffect, useRef } from 'react';

export function useEntryReads({
  scope,
  paused,
  refresh,
}: {
  scope: string | null;
  paused: boolean;
  refresh: (available: () => boolean) => Promise<unknown>;
}) {
  const current = useRef({ paused, refresh });
  const resume = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    current.current = { paused, refresh };
  }, [paused, refresh]);
  useEffect(() => {
    if (!scope) return;
    let live = true;
    let running = false;
    let pending = true;
    let scheduled: number | undefined;
    const available = () => live && !current.current.paused;
    const schedule = (delay = 0) => {
      if (scheduled !== undefined || running || !available()) return;
      scheduled = window.setTimeout(() => {
        scheduled = undefined;
        void run();
      }, delay);
    };
    const run = async () => {
      if (!pending || running || !available()) return;
      pending = false;
      running = true;
      try {
        if ((await current.current.refresh(available)) === false) {
          pending = true;
        }
      } catch {
        return;
      } finally {
        running = false;
        if (live && !available()) pending = true;
        if (pending) schedule(250);
      }
    };
    resume.current = () => {
      if (pending) schedule();
    };
    schedule();
    return () => {
      live = false;
      if (scheduled !== undefined) window.clearTimeout(scheduled);
      resume.current = () => {};
    };
  }, [scope]);
  useEffect(() => resume.current(), [paused]);
}
