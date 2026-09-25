import { Description, Field, Label, Radio, RadioGroup } from '@headlessui/react';
import type { RadioGroupFieldProps } from '@ledova/shared';

const RadioGroupField = <Value extends string>({
  label,
  value,
  options,
  error,
  onChange,
}: RadioGroupFieldProps<Value>) => (
  <div className="space-y-3">
    <RadioGroup value={value} onChange={onChange} className="space-y-2">
      <Label className="mb-3 block text-sm font-medium text-text-body">{label}</Label>
      {options.map((option) => (
        <Field key={option.value} className="flex items-center gap-3 text-sm text-text-body">
          <Radio
            value={option.value}
            className="group flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-tertiary focus:outline-none data-[checked]:border-brand data-[checked]:bg-brand data-[focus]:ring-2 data-[focus]:ring-border-focus data-[focus]:ring-offset-1"
          >
            <span className="hidden h-2 w-2 rounded-full bg-white group-data-[checked]:block" />
          </Radio>
          <Label className="cursor-pointer hover:text-text-primary">{option.label}</Label>
        </Field>
      ))}
      {error && (
        <Description as="p" className="text-error-light text-sm mt-1" role="alert">
          {error.join(' ')}
        </Description>
      )}
    </RadioGroup>
  </div>
);

export default RadioGroupField;
