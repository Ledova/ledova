import { useId, useRef, useState } from 'react';

export type Problems<K extends string> = Partial<Record<K, string | null | false>>;

export type FieldCheck = { id: string; error: string | null };

export function hasProblems<K extends string>(problems: Problems<K>) {
  return Object.values(problems).some(Boolean);
}

function useFocusClaim() {
  const focused = useRef(0);
  return (count: number) => {
    if (count <= focused.current) return false;
    focused.current = count;
    return true;
  };
}

export function useErrorSummary<K extends string>(problems: Problems<K>) {
  const prefix = useId();
  const claim = useFocusClaim();
  const [attempt, setAttempt] = useState<{ count: number; failed: readonly K[] }>({ count: 0, failed: [] });
  const listed = attempt.failed.filter((key) => problems[key]);
  return {
    check: (keys?: readonly K[]) => {
      const failed = (Object.keys(problems) as K[]).filter((key) => problems[key] && (!keys || keys.includes(key)));
      if (failed.length === 0) {
        setAttempt((current) => (current.failed.length ? { ...current, failed: [] } : current));
        return true;
      }
      setAttempt((current) => ({ count: current.count + 1, failed }));
      return false;
    },
    reset: () => setAttempt((current) => (current.failed.length ? { ...current, failed: [] } : current)),
    field: (key: K): FieldCheck => ({
      id: `${prefix}${key}`,
      error: (listed.includes(key) && problems[key]) || null,
    }),
    summary: {
      attempt: attempt.count,
      problems: listed.map((key) => ({ id: `${prefix}${key}`, message: problems[key] as string })),
      claim,
    },
  };
}

export function useFieldErrorSummary<K extends string>(
  errors: Partial<Record<string, readonly string[]>>,
  keys: readonly K[],
) {
  const prefix = useId();
  const claim = useFocusClaim();
  const [attempt, setAttempt] = useState(0);
  const message = (key: K) => errors[key]?.join(' ') || null;
  return {
    reported: () => setAttempt((count) => count + 1),
    field: (key: K): FieldCheck => ({ id: `${prefix}${key}`, error: message(key) }),
    summary: {
      attempt,
      problems: keys.flatMap((key) => {
        const text = message(key);
        return text ? [{ id: `${prefix}${key}`, message: text }] : [];
      }),
      claim,
    },
  };
}
