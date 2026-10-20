import { useMemo } from 'react';
import { NEW_PERSON, personChoices, type Person } from '@ledova/shared';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { SearchSelect } from '@components/SearchSelect';

const READ_ONLY = 'read-only:bg-surface-tertiary read-only:text-text-muted';
const NEW_CHOICE = [{ value: 'new', label: NEW_PERSON }];
const PEOPLE = ['person', 'people'] as const;
const NONE: string[] = [];

export function PersonSelect({
  label,
  people,
  value,
  onChange,
  allowNew = true,
  disabledMembers = NONE,
  context,
  disabled = false,
}: {
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
}: {
  name: string;
  residentialAddress: string;
  onName: (value: string) => void;
  onResidentialAddress: (value: string) => void;
  nameReadOnly?: boolean;
  addressReadOnly?: boolean;
}) {
  return (
    <>
      <label className={LABEL}>
        Name
        <input
          className={`${FIELD_CLASS} ${READ_ONLY}`}
          value={name}
          maxLength={255}
          readOnly={nameReadOnly}
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <label className={LABEL}>
        Residential address
        <textarea
          className={`${FIELD_CLASS} ${READ_ONLY}`}
          value={residentialAddress}
          maxLength={1000}
          rows={2}
          readOnly={addressReadOnly}
          onChange={(event) => onResidentialAddress(event.target.value)}
        />
      </label>
    </>
  );
}
