import { useEffect, useRef } from 'react';

type Listed = { id: string; message: string };

function focusField(id: string) {
  const field = document.getElementById(id);
  field?.scrollIntoView({ block: 'center' });
  field
    ?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, button')
    ?.focus({ preventScroll: true });
}

export function ErrorSummary({ attempt, problems }: { attempt: number; problems: Listed[] }) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (attempt > 0) summary.current?.focus();
  }, [attempt]);
  if (problems.length === 0) return null;
  return (
    <div ref={summary} role="alert" tabIndex={-1} className="space-y-1 text-sm text-error-light outline-none">
      <p>Before continuing:</p>
      <ul className="list-disc space-y-1 pl-5">
        {problems.map(({ id, message }) => (
          <li key={id}>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
