import { useLayoutEffect, useRef } from 'react';

export function FormSteps({
  label,
  steps,
  current,
  onSelect,
  reachable,
}: {
  label: string;
  steps: readonly { id: string; label: string }[];
  current: string;
  onSelect?: (id: string) => void;
  reachable?: (id: string) => boolean;
}) {
  const selected = useRef<string | null>(null);
  const active = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (selected.current !== current) return;
    selected.current = null;
    active.current?.focus({ preventScroll: true });
  }, [current]);
  return (
    <ol aria-label={label} className="grid auto-cols-fr grid-flow-col gap-2 sm:gap-3">
      {steps.map((step, index) => {
        const here = current === step.id;
        const layout = 'flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center';
        const content = (
          <>
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${here ? 'bg-brand-mid text-white' : 'bg-surface-tertiary text-text-muted'}`}
            >
              {index + 1}
            </span>
            <span className="text-xs font-medium [overflow-wrap:anywhere] sm:text-sm">
              <span className="sr-only">{index + 1}. </span>
              {step.label}
            </span>
          </>
        );
        return (
          <li
            key={step.id}
            aria-current={here ? 'step' : undefined}
            className={`min-w-0 border-b-2 pb-3 ${here ? 'border-brand-mid text-text-primary' : 'border-border-subtle text-text-muted'}`}
          >
            {onSelect && !here ? (
              <button
                type="button"
                aria-label={`${index + 1}. ${step.label}`}
                disabled={!(reachable?.(step.id) ?? true)}
                onClick={() => {
                  selected.current = step.id;
                  onSelect(step.id);
                }}
                className={`${layout} w-full rounded-md text-left transition-colors enabled:hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {content}
              </button>
            ) : (
              <div ref={here ? active : undefined} tabIndex={onSelect && here ? -1 : undefined} className={layout}>
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
