import { useId } from 'react';

export function Choices<T extends string>({
  id,
  error,
  legend,
  options,
  value,
  onChange,
  unavailable = [],
  disabled = false,
}: {
  id?: string;
  error?: string | null;
  legend: string;
  options: readonly (readonly [T, string])[];
  value: T | '';
  onChange: (value: T) => void;
  unavailable?: readonly T[];
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset
      id={id}
      disabled={disabled}
      aria-describedby={error ? `${name}-error` : undefined}
      className="min-w-0 text-sm text-text-primary"
    >
      <legend>{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {options.map(([option, label]) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              disabled={unavailable.includes(option)}
              aria-invalid={error ? true : undefined}
              onChange={() => onChange(option)}
              className="h-4 w-4"
            />
            {label}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm text-error-light">
          {error}
        </p>
      )}
    </fieldset>
  );
}
