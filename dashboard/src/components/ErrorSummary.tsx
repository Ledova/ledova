import { useEffect, useRef } from 'react';

type Listed = { id?: string; message: string };

function focusField(id: string) {
  const field = document.getElementById(id);
  field?.scrollIntoView({ block: 'center' });
  field
    ?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)',
    )
    ?.focus({ preventScroll: true });
}

export function ErrorSummary({
  attempt,
  problems,
  className,
  claim,
}: {
  attempt: number;
  problems: Listed[];
  className?: string;
  claim?: (attempt: number) => boolean;
}) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (attempt > 0 && (!claim || claim(attempt))) summary.current?.focus();
  }, [attempt, claim]);
  if (problems.length === 0) return null;
  return (
    <div
      ref={summary}
      role="alert"
      tabIndex={-1}
      className={`space-y-1 text-sm text-error-light outline-none${className ? ` ${className}` : ''}`}
    >
      <p>Before continuing:</p>
      <ul className="list-disc space-y-1 pl-5">
        {problems.map(({ id, message }) => (
          <li key={id ?? message}>
            {id ? (
              <a
                href={`#${id}`}
                className="underline"
                onClick={(event) => {
                  event.preventDefault();
                  focusField(id);
                }}
              >
                {message}
              </a>
            ) : (
              message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
