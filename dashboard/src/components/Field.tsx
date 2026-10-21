import { createContext, useContext, useId, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
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
  id,
  label,
  hint,
  error,
  optional = false,
  aside,
  className,
  alert = false,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  aside?: ReactNode;
  className?: string;
  alert?: boolean;
  children: ReactNode;
}) {
  const name = (
    <Label className="block">
      {label}
      {optional && ' (optional)'}
    </Label>
  );
  return (
    <HeadlessField id={id} className={className ? `${FIELD} ${className}` : FIELD}>
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
      {error && (
        <Description role={alert ? 'alert' : undefined} className="mt-1 text-sm text-error-light">
          {error}
        </Description>
      )}
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
  id,
  label,
  hint,
  error,
  optional,
  onFile,
  ...props
}: Omit<InputProps, 'id' | 'type' | 'accept' | 'onChange' | 'className'> & {
  id?: string;
  label: ReactNode;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  onFile: (file: File | null) => void;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <Field
      id={id}
      label={label}
      hint={hint ? `${UPLOAD_RULE.HINT} ${hint}` : UPLOAD_RULE.HINT}
      error={refusal ?? error}
      alert={!!refusal}
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

export function CheckboxField({
  id,
  error,
  label,
  ...props
}: Omit<ComponentProps<'input'>, 'id' | 'type' | 'className'> & {
  id?: string;
  error?: string | null;
  label: ReactNode;
}) {
  const errorId = useId();
  return (
    <div id={id}>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...props}
        />
        {label}
      </label>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-error-light">
          {error}
        </p>
      )}
    </div>
  );
}
