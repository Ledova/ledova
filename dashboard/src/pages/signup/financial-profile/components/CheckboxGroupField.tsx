import { useId } from 'react';
import { Checkbox, Field, Label } from '@headlessui/react';
import type { CheckboxGroupFieldProps } from '@ledova/shared';

const CheckboxGroupField = ({ label, value, options, error, onChange }: CheckboxGroupFieldProps) => {
  const labelId = useId();

  const handleCheckboxChange = (optionValue: string, checked: boolean) => {
    if (checked) {
      onChange([...value, optionValue]);
    } else {
      onChange(value.filter((val) => val !== optionValue));
    }
  };

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-3">
      <p id={labelId} className="block text-sm font-medium text-text-body">
        {label} <span className="text-text-subtle">(select all that apply)</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <Field key={option.value} className="flex items-center gap-2 text-sm text-text-body">
            <Checkbox
              checked={value.includes(option.value)}
              onChange={(checked) => handleCheckboxChange(option.value, checked)}
              className="group flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border border-border bg-surface-tertiary focus:outline-none data-[checked]:border-brand data-[checked]:bg-brand data-[focus]:ring-2 data-[focus]:ring-border-focus data-[focus]:ring-offset-1"
            >
              <svg
                className="hidden h-3 w-3 text-white group-data-[checked]:block"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </Checkbox>
            <Label className="cursor-pointer hover:text-text-primary">{option.label}</Label>
          </Field>
        ))}
      </div>
      {error && (
        <p className="text-error-light text-sm mt-1" role="alert">
          {error.join(' ')}
        </p>
      )}
    </div>
  );
};

export default CheckboxGroupField;
