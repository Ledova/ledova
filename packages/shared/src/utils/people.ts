import type { RegisterTransferMembers } from '../types/domain/register-transfer';

export interface Person {
  member: string;
  name: string;
  residentialAddress: string;
  walletless: boolean;
  particularsRetained: boolean;
  currentShares: string;
  lastCeasedOn: string | null;
  awardOnly: boolean;
}

export interface PersonChoice {
  value: string;
  label: string;
  detail: string;
}

export const NEW_PERSON = 'New person';

export const NEW_PERSON_PROBLEMS = {
  NAME: 'Give the new person’s name.',
  ADDRESS: 'Give the new person’s residential address.',
} as const;

export function peopleFrom(data: RegisterTransferMembers | undefined): Person[] {
  if (!data) return [];
  return [
    ...data.members.map((row) => ({
      member: row.member,
      name: row.name || '',
      residentialAddress: row.residentialAddress ?? '',
      walletless: row.walletless,
      particularsRetained: row.particularsRetained,
      currentShares: row.currentShares,
      lastCeasedOn: row.lastCeasedOn ?? null,
      awardOnly: false,
    })),
    ...data.awardRecipients.map((row) => ({
      member: row.member,
      name: row.name,
      residentialAddress: row.residentialAddress,
      walletless: true,
      particularsRetained: true,
      currentShares: '0',
      lastCeasedOn: null,
      awardOnly: true,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name) || left.member.localeCompare(right.member));
}

export function personChoices(people: readonly Person[], context?: (person: Person) => string): PersonChoice[] {
  const records = new Map<string, Set<string>>();
  const particulars = (person: Person) => JSON.stringify([person.name, person.residentialAddress]);
  for (const person of people)
    records.set(particulars(person), (records.get(particulars(person)) ?? new Set()).add(person.member));
  return people.map((person) => ({
    value: person.member,
    label: person.name || 'Name not recorded',
    detail: [
      person.residentialAddress,
      person.awardOnly ? 'Award recipient without shares' : '',
      context?.(person) ?? '',
      (records.get(particulars(person))?.size ?? 0) > 1 ? `Record ${person.member.slice(-8)}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }));
}

export function personRequest(choice: string, people: readonly Person[], fresh: string, name: string, address: string) {
  if (choice === 'new')
    return { member: fresh, newMember: true, name: name.trim(), residentialAddress: address.trim() };
  const person = people.find((row) => row.member === choice);
  return person?.awardOnly
    ? { member: person.member, newMember: true, name: person.name, residentialAddress: person.residentialAddress }
    : { member: choice, newMember: false };
}
