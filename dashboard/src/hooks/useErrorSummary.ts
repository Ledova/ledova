import { useId, useRef, useState } from 'react';

export type Problems<K extends string> = Partial<Record<K, string | null | false>>;

export type FieldCheck = { id: string; error: string | null };

export function hasProblems<K extends string>(problems: Problems<K>) {
  return Object.values(problems).some(Boolean);
}

export function useErrorSummary<K extends string>(problems: Problems<K>) {
  const prefix = useId();
  const focused = useRef(0);
  const [attempt, setAttempt] = useState<{ count: number; failed: readonly K[] }>({ count: 0, failed: [] });
  const listed = attempt.failed.filter((key) => problems[key]);
  return {
    check: (keys?: readonly K[]) => {
      const failed = (Object.keys(problems) as K[]).filter((key) => problems[key] && (!keys || keys.includes(key)));
      if (failed.length === 0) return true;
      setAttempt((current) => ({ count: current.count + 1, failed }));
      return false;
    },
    field: (key: K): FieldCheck => ({
      id: `${prefix}${key}`,
      error: (listed.includes(key) && problems[key]) || null,
    }),
    summary: {
      attempt: attempt.count,
      problems: listed.map((key) => ({ id: `${prefix}${key}`, message: problems[key] as string })),
      claim: (count: number) => {
        if (count <= focused.current) return false;
        focused.current = count;
        return true;
      },
    },
  };
}
