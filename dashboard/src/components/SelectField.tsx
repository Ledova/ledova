import { Select } from '@headlessui/react';
import { Field } from '@components/Field';
import { FIELD_CLASS } from '@components/fieldClass';

export interface SelectOption {
  value: string;
  label: string;
  reference?: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const shared = (label: string) => options.filter((option) => option.label === label).length > 1;
  return (
    <Field label={label}>
      <Select
        className={FIELD_CLASS}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.reference && shared(option.label) ? `${option.label} · ${option.reference}` : option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
