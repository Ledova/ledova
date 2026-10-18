import { FIELD_CLASS } from '@components/fieldClass';
import { Field } from './Field';

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        className={FIELD_CLASS}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </Field>
  );
}
