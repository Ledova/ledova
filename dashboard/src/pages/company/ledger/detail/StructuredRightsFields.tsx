import { FIELD_LIMITS, type ClassRightsAttributes } from '@ledova/shared';
import { CheckboxField, Field, TextInput } from '@components/Field';
import { SelectField } from '@components/SelectField';
import type { FieldCheck } from '@hooks/useErrorSummary';
import { RIGHTS_GROUPS, preferenceMeasure, rightsGroupValues, visibleRightsFields } from './rightsAttributes';

export function StructuredRightsFields({
  attributes,
  onChange,
  disabled,
  field,
}: {
  attributes: ClassRightsAttributes;
  onChange: (attributes: ClassRightsAttributes) => void;
  disabled: boolean;
  field: (key: string) => FieldCheck;
}) {
  return (
    <div className="grid items-start gap-6 sm:grid-cols-2">
      {RIGHTS_GROUPS.map((group) => {
        const values = rightsGroupValues(attributes, group.key);
        const change = (key: string, value: unknown) =>
          onChange({ ...attributes, [group.key]: { ...values, [key]: value } });
        return (
          <fieldset key={group.key} disabled={disabled} className="min-w-0 space-y-3">
            <legend className="sr-only">{group.label} rights</legend>
            <SelectField
              label={group.label}
              options={group.options}
              value={String(values.type ?? 'not_recorded')}
              disabled={disabled}
              onChange={(type) => {
                const next = { ...attributes };
                if (type === 'not_recorded') delete next[group.key];
                else next[group.key] = { type } as never;
                onChange(next);
              }}
            />
            {group.measure && values.type === 'preferential' && (
              <SelectField
                label={group.measure.label}
                options={group.measure.options}
                value={preferenceMeasure(group, values)}
                disabled={disabled}
                onChange={(measure) => {
                  const next = { ...values };
                  for (const key of ['rate', 'multiple', 'amount', 'basis', 'currency']) delete next[key];
                  if (measure !== 'not_recorded') next[measure] = '';
                  onChange({ ...attributes, [group.key]: next });
                }}
              />
            )}
            {visibleRightsFields(group, values).map((definition) => {
              const check = field(`${group.key}.${definition.key}`);
              const value = values[definition.key];
              if (definition.kind === 'checkbox')
                return (
                  <CheckboxField
                    key={definition.key}
                    {...check}
                    label={definition.label}
                    checked={value === true}
                    onChange={(event) => change(definition.key, event.target.checked ? true : undefined)}
                  />
                );
              if (definition.kind === 'select')
                return (
                  <SelectField
                    key={definition.key}
                    {...check}
                    label={definition.label}
                    options={definition.options!}
                    value={String(value ?? 'not_recorded')}
                    disabled={disabled}
                    onChange={(selected) => {
                      const next = { ...values, [definition.key]: selected };
                      if (selected === 'not_recorded') delete next[definition.key];
                      if (definition.key === 'participation' && selected !== 'capped') delete next.cap;
                      onChange({ ...attributes, [group.key]: next });
                    }}
                  />
                );
              return (
                <Field key={definition.key} {...check} label={definition.label} hint={definition.hint}>
                  <TextInput
                    inputMode={definition.kind === 'decimal' ? 'decimal' : undefined}
                    value={String(value ?? '')}
                    maxLength={
                      definition.key === 'currency'
                        ? 3
                        : definition.kind === 'decimal'
                          ? FIELD_LIMITS.CLASS_RIGHTS_DECIMAL
                          : FIELD_LIMITS.NAME
                    }
                    onChange={(event) =>
                      change(
                        definition.key,
                        definition.key === 'currency' ? event.target.value.toUpperCase() : event.target.value,
                      )
                    }
                  />
                </Field>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
