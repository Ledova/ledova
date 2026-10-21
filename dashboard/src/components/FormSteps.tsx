export function FormSteps({
  label,
  steps,
  current,
}: {
  label: string;
  steps: readonly { id: string; label: string }[];
  current: string;
}) {
  return (
    <ol aria-label={label} className="grid grid-cols-3 gap-3">
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={current === step.id ? 'step' : undefined}
          className={`flex min-w-0 flex-col gap-2 border-b-2 pb-3 sm:flex-row sm:items-center ${current === step.id ? 'border-brand-mid text-text-primary' : 'border-border-subtle text-text-muted'}`}
        >
          <span
            aria-hidden="true"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${current === step.id ? 'bg-brand-mid text-white' : 'bg-surface-tertiary text-text-muted'}`}
          >
            {index + 1}
          </span>
          <span className="text-xs font-medium [overflow-wrap:anywhere] sm:text-sm">
            <span className="sr-only">{index + 1}. </span>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
