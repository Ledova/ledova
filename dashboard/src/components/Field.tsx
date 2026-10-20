import { createContext, useContext, useState, type ReactNode, type Ref } from 'react';
import {
  Description,
  Field as HeadlessField,
  Input,
  Label,
  Textarea,
  type InputProps,
  type TextareaProps,
} from '@headlessui/react';
import { UPLOAD_RULE, uploadRefusal } from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';

const Invalid = createContext(false);

const FIELD = 'block text-sm text-text-primary';

export function Field({
  label,
  hint,
  error,
  optional = false,
  aside,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const name = (
    <Label className="block">
      {label}
      {optional && ' (optional)'}
    </Label>
  );
  return (
    <HeadlessField className={className ? `${FIELD} ${className}` : FIELD}>
      {aside ? (
        <div className="flex items-center justify-between gap-2">
          {name}
          {aside}
        </div>
      ) : (
        name
      )}
      <Invalid.Provider value={!!error}>{children}</Invalid.Provider>
      {hint && <Description className="mt-1 text-sm text-text-muted">{hint}</Description>}
      {error && <Description className="mt-1 text-sm text-error-light">{error}</Description>}
    </HeadlessField>
  );
}

export function TextInput({ className = FIELD_CLASS, ...props }: InputProps & { ref?: Ref<HTMLInputElement> }) {
  return <Input invalid={useContext(Invalid)} className={className} {...props} />;
}

export function TextArea({ className = FIELD_CLASS, ...props }: TextareaProps & { ref?: Ref<HTMLTextAreaElement> }) {
  return <Textarea invalid={useContext(Invalid)} className={className} {...props} />;
}

export function FileField({
  label,
  hint,
  optional,
  onFile,
  ...props
}: Omit<InputProps, 'type' | 'accept' | 'onChange' | 'className'> & {
  label: ReactNode;
  hint?: string;
  optional?: boolean;
  onFile: (file: File | null) => void;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <Field
      label={label}
      hint={hint ? `${UPLOAD_RULE.HINT} ${hint}` : UPLOAD_RULE.HINT}
      error={refusal}
      optional={optional}
    >
      <TextInput
        {...props}
        type="file"
        accept={UPLOAD_RULE.ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          const problem = file && uploadRefusal(file);
          setRefusal(problem);
          if (problem) event.target.value = '';
          onFile(problem ? null : file);
        }}
      />
    </Field>
  );
}
