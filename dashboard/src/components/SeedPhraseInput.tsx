import { Field, TextArea } from '@components/Field';
import { FIELD_CLASS } from '@components/fieldClass';
import type { CSSProperties } from 'react';

interface SeedPhraseInputProps {
  id?: string;
  error?: string | null;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SeedPhraseInput({ id, error, value, onChange, disabled = false }: SeedPhraseInputProps) {
  return (
    <Field
      id={id}
      error={error}
      label="Seed phrase"
      hint="Your seed phrase is used locally for signing and is never stored or transmitted."
    >
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter your 12 or 24 word seed phrase"
        rows={3}
        disabled={disabled}
        className={`${FIELD_CLASS} resize-none disabled:opacity-50`}
        style={{ WebkitTextSecurity: 'disc' } as CSSProperties}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </Field>
  );
}
