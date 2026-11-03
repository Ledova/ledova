import { useMemo } from 'react';
import { NEW_PERSON, personChoices, type Person, type PersonChoice } from '@ledova/shared';
import { SearchSelect } from './SearchSelect';

const NEW_CHOICE: PersonChoice[] = [{ value: 'new', label: NEW_PERSON, detail: '' }];
const PEOPLE = ['person', 'people'] as const;
const NONE: string[] = [];

export function PersonSelect({
  label,
  people,
  value,
  onChange,
  context,
  allowNew = false,
  disabledMembers = NONE,
  disabled = false,
  error,
}: {
  label: string;
  people: Person[];
  value: string;
  onChange: (value: string) => void;
  context?: (person: Person) => string;
  allowNew?: boolean;
  disabledMembers?: string[];
  disabled?: boolean;
  error?: string | null;
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
      first={allowNew ? NEW_CHOICE : undefined}
      value={value}
      onChange={onChange}
      placeholder="Type a name or address"
      noun={PEOPLE}
      disabled={disabled}
      error={error}
    />
  );
}
