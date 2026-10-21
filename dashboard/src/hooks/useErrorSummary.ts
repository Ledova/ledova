import { useId, useState } from 'react';

export type Problems<K extends string> = Partial<Record<K, string | null | false>>;

export type FieldCheck = { id: string; error: string | null };

export function hasProblems<K extends string>(problems: Problems<K>) {
  return Object.values(problems).some(Boolean);
}

export function useErrorSummary<K extends string>(problems: Problems<K>) {
  const prefix = useId();
  const [attempt, setAttempt] = useState(0);
  const listed = (Object.keys(problems) as K[]).filter((key) => problems[key]);
  return {
    check: () => {
      if (listed.length === 0) return true;
      setAttempt((count) => count + 1);
      return false;
    },
    field: (key: K): FieldCheck => ({ id: `${prefix}${key}`, error: (attempt > 0 && problems[key]) || null }),
    summary: {
      attempt,
      problems: attempt > 0 ? listed.map((key) => ({ id: `${prefix}${key}`, message: problems[key] as string })) : [],
    },
  };
}
