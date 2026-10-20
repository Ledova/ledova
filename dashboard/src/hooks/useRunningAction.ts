import { useState } from 'react';

export function useRunningAction() {
  const [running, setRunning] = useState<string | null>(null);
  const track = (key: string, work: unknown) => {
    setRunning(key);
    void Promise.resolve(work).finally(() => setRunning(null));
  };
  return { running, track };
}
