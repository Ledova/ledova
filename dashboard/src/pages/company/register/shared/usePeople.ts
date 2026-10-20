import { useQuery } from '@tanstack/react-query';
import {
  getRegisterTransferMembers,
  isRegisterImportMembers,
  type OrderSubmissionOwner,
  type RegisterTransferMembers,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';

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

export const NEW_PERSON = 'New person';

export function allPeopleKey(owner: OrderSubmissionOwner) {
  return [...registerKey(owner), 'people'];
}

export function peopleKey(owner: OrderSubmissionOwner, token: string) {
  return [...allPeopleKey(owner), token];
}

export async function readPeople(token: string, guard: () => void) {
  guard();
  const { data } = await getRegisterTransferMembers(apiClient, token, { ledovaSubmissionGuard: guard });
  guard();
  if (!isRegisterImportMembers(data))
    throw new Error('The company shareholder and award recipient choices could not be confirmed.');
  return data;
}

export function usePeople(owner: OrderSubmissionOwner, token: string, guard: () => void, enabled = true) {
  return useQuery({
    queryKey: peopleKey(owner, token),
    enabled,
    queryFn: () => readPeople(token, guard),
    ...READ_TIMING,
  });
}

export function peopleFrom(data: RegisterTransferMembers | undefined) {
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

export function personLabel(person: Person, people: Person[], context = '') {
  const twin = people.some(
    (other) =>
      other.member !== person.member &&
      other.name === person.name &&
      other.residentialAddress === person.residentialAddress,
  );
  return [
    person.name || 'Name not recorded',
    person.residentialAddress,
    person.awardOnly ? 'Award recipient without shares' : '',
    context,
    twin ? `Record ${person.member.slice(-8)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function personRequest(choice: string, people: Person[], fresh: string, name: string, address: string) {
  if (choice === 'new')
    return { member: fresh, newMember: true, name: name.trim(), residentialAddress: address.trim() };
  const person = people.find((row) => row.member === choice);
  return person?.awardOnly
    ? { member: person.member, newMember: true, name: person.name, residentialAddress: person.residentialAddress }
    : { member: choice, newMember: false };
}
