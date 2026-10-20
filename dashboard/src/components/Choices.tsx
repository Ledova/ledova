import { useId } from 'react';

export function Choices<T extends string>({
  legend,
  options,
  value,
  onChange,
  unavailable = [],
  disabled = false,
}: {
  legend: string;
  options: readonly (readonly [T, string])[];
  value: T | '';
  onChange: (value: T) => void;
  unavailable?: readonly T[];
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 text-sm text-text-primary">
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
              onChange={() => onChange(option)}
              className="h-4 w-4"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
