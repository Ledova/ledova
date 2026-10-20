import { useMemo } from 'react';
import { NEW_PERSON, personChoices, type Person, type SearchChoice } from '@ledova/shared';
import { SearchSelect } from '../SearchSelect';
import { Field } from './RegisterFields';

const NEW_CHOICE: readonly SearchChoice[] = [{ value: 'new', label: NEW_PERSON }];
const NO_CHOICE: readonly SearchChoice[] = [];
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
      first={allowNew ? NEW_CHOICE : NO_CHOICE}
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
  editable,
  readOnly = false,
}: {
  name: string;
  residentialAddress: string;
  onName: (value: string) => void;
  onResidentialAddress: (value: string) => void;
  editable: boolean;
  readOnly?: boolean;
}) {
  return (
    <>
      <Field label="Name" value={name} editable={editable && !readOnly} maxLength={255} onChange={onName} />
      <Field
        label="Residential address"
        value={residentialAddress}
        editable={editable && !readOnly}
        multiline
        maxLength={1000}
        onChange={onResidentialAddress}
      />
    </>
  );
}
