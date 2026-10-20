import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { NEW_PERSON, personLabel, type Person } from './usePeople';

const READ_ONLY = 'read-only:bg-surface-tertiary read-only:text-text-muted';

export function PersonSelect({
  label,
  people,
  value,
  onChange,
  allowNew = true,
  placeholder,
  disabledMembers = [],
  context,
  disabled = false,
}: {
  label: string;
  people: Person[];
  value: string;
  onChange: (value: string) => void;
  allowNew?: boolean;
  placeholder?: string;
  disabledMembers?: string[];
  context?: (person: Person) => string;
  disabled?: boolean;
}) {
  return (
    <label className={LABEL}>
      {label}
      <select
        className={FIELD_CLASS}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {allowNew && <option value="new">{NEW_PERSON}</option>}
        {people.map((person) => (
          <option key={person.member} value={person.member} disabled={disabledMembers.includes(person.member)}>
            {personLabel(person, people, context?.(person))}
          </option>
        ))}
      </select>
    </label>
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
