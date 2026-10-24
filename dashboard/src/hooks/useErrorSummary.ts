import { useId, useState } from 'react';
import { useFocusClaim, type FieldCheck } from '@ledova/shared';

export { hasProblems, useErrorSummary, type FieldCheck, type Problems } from '@ledova/shared';

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
