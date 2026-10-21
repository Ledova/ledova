import { Field, TextArea, TextInput } from '@components/Field';
import { useMemo } from 'react';
import { FIELD_LIMITS, NEW_PERSON, personChoices, type Person } from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { SearchSelect } from '@components/SearchSelect';
import type { FieldCheck } from '@hooks/useErrorSummary';

const READ_ONLY = 'read-only:bg-surface-tertiary read-only:text-text-muted';
const NEW_CHOICE = [{ value: 'new', label: NEW_PERSON }];
const PEOPLE = ['person', 'people'] as const;
const NONE: string[] = [];

export function PersonSelect({
  id,
  error,
  label,
  people,
  value,
  onChange,
  allowNew = true,
  disabledMembers = NONE,
  context,
  disabled = false,
}: {
  id?: string;
  error?: string | null;
  label: string;
  people: Person[];
  value: string;
  onChange: (value: string) => void;
  allowNew?: boolean;
  disabledMembers?: string[];
  context?: (person: Person) => string;
  disabled?: boolean;
}) {
  const choices = useMemo(() => {
    const added = new Set(disabledMembers);
    return personChoices(people, context).map((choice) =>
      added.has(choice.value) ? { ...choice, unavailable: 'Already added' } : choice,
    );
  }, [people, context, disabledMembers]);
  return (
    <SearchSelect
      id={id}
      error={error}
      label={label}
      choices={choices}
      first={allowNew ? NEW_CHOICE : []}
      value={value}
      onChange={onChange}
      placeholder="Type a name or address"
      disabled={disabled}
      noun={PEOPLE}
    />
  );
}

export function PersonFields({
  name,
  residentialAddress,
  onName,
  onResidentialAddress,
  nameReadOnly = false,
  addressReadOnly = false,
  nameCheck,
  addressCheck,
}: {
  nameCheck?: FieldCheck;
  addressCheck?: FieldCheck;
  name: string;
  residentialAddress: string;
  onName: (value: string) => void;
  onResidentialAddress: (value: string) => void;
  nameReadOnly?: boolean;
  addressReadOnly?: boolean;
}) {
  return (
    <>
      <Field {...nameCheck} label="Name">
        <TextInput
          className={`${FIELD_CLASS} ${READ_ONLY}`}
          value={name}
          maxLength={FIELD_LIMITS.NAME}
          readOnly={nameReadOnly}
          onChange={(event) => onName(event.target.value)}
        />
      </Field>
      <Field {...addressCheck} label="Residential address">
        <TextArea
          className={`${FIELD_CLASS} ${READ_ONLY}`}
          value={residentialAddress}
          maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
          rows={2}
          readOnly={addressReadOnly}
          onChange={(event) => onResidentialAddress(event.target.value)}
        />
      </Field>
    </>
  );
}
