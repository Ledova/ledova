import type { ReactNode } from 'react';
import { Description, Field, Label } from '@headlessui/react';

export function AuthField({
  id,
  label,
  icon,
  hint,
  error,
  below,
  children,
}: {
  id?: string;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  below?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Field id={id} className="space-y-2">
      <Label className="block text-sm font-medium text-text-body">{label}</Label>
      {hint && <Description className="text-text-subtle text-xs">{hint}</Description>}
      <div className="relative">
        {icon && <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">{icon}</div>}
        {children}
      </div>
      {below}
      {error && <Description className="text-error-light text-sm mt-1">{error}</Description>}
    </Field>
  );
}
