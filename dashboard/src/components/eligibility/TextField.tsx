import { FIELD_CLASS } from '@components/fieldClass';
import { Field } from './Field';

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  maxLength,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        className={FIELD_CLASS}
        type={type}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </Field>
  );
}
