import { useMemo } from 'react';
import { NEW_PERSON, personChoices, type Person, type PersonChoice } from '@ledova/shared';
import { SearchSelect } from '../../components/SearchSelect';

const NEW_CHOICE: PersonChoice[] = [{ value: 'new', label: NEW_PERSON, detail: '' }];
const PEOPLE = ['person', 'people'] as const;

export function PersonSelect({
  label,
  people,
  value,
  onChange,
  context,
  allowNew = false,
  disabled = false,
  error,
}: {
  label: string;
  people: Person[];
  value: string;
  onChange: (value: string) => void;
  context?: (person: Person) => string;
  allowNew?: boolean;
  disabled?: boolean;
  error?: string | null;
}) {
  const choices = useMemo(() => personChoices(people, context), [people, context]);
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
