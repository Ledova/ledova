import { useQueries } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { HOLDER_TYPE_LABELS } from '../constants/business/register';
import { REGISTER_PARTICULARS_COPY } from '../constants/business/register-particulars';
import type { CompanyShareTokenListItem, OwnCompanyAppointment } from '../types';
import { appointmentForParticularsEdit } from '../utils/register-commands';
import { useApiClient } from './useApiClient';
import { useOwnAppointments } from './useOwnAppointments';
import { peopleKey, readPeople } from './usePeople';
import { useRegisterClasses } from './useRegisterClasses';
import { registersQuery } from './useRegisters';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

type Editing = { uuid: string; name: string; classes: string[]; appointment: OwnCompanyAppointment };

function editingCompanies(classes: CompanyShareTokenListItem[], appointments: OwnCompanyAppointment[]) {
  const companies = new Map<string, Editing>();
  for (const item of classes) {
    const appointment = appointmentForParticularsEdit(appointments, item.companyUuid);
    if (!appointment) continue;
    const company = companies.get(item.companyUuid) ?? {
      uuid: item.companyUuid,
      name: item.companyName,
      classes: [],
      appointment,
    };
    company.classes.push(item.uuid);
    companies.set(item.companyUuid, company);
  }
  return [...companies.values()];
}

export function useParticularsMember(
  owner: OrderSubmissionOwner,
  guard: () => void,
  member: string,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const classes = useRegisterClasses(owner, guard, session);
  const appointments = useOwnAppointments(owner, guard, { session });
  const editing = classes.data && appointments.data ? editingCompanies(classes.data, appointments.data) : [];
  const registers = useQueries({
    queries: editing.map((company) => registersQuery(apiClient, owner, company.classes, guard, session)),
  });
  const people = useQueries({
    queries: editing.map((company) => ({
      queryKey: peopleKey(owner, company.classes[0] ?? ''),
      enabled: company.classes.length > 0,
      queryFn: () => readPeople(apiClient, company.classes[0] ?? '', guard, session),
      ...READ_TIMING,
      refetchOnMount: 'always' as const,
    })),
  });
  const found = editing.flatMap<{
    company: Editing;
    name: string | null;
    label: string;
    read: { isError: boolean; refetch: () => unknown };
    particulars: (typeof people)[number];
  }>((company, index) => {
    const read = registers[index];
    const particulars = people[index];
    if (!read || !particulars) return [];
    const holder = read.data?.flatMap((register) => register.holders).find((row) => row.member === member);
    if (holder)
      return [
        {
          company,
          name: holder.name,
          label: holder.name || HOLDER_TYPE_LABELS[holder.holderType],
          read,
          particulars,
        },
      ];
    const recipient = particulars.data?.members.find((row) => row.member === member && row.onRegister === false);
    return recipient
      ? [
          {
            company,
            name: recipient.name,
            label: recipient.name || REGISTER_PARTICULARS_COPY.UNNAMED_MEMBER,
            read: particulars,
            particulars,
          },
        ]
      : [];
  })[0];
  return { classes, appointments, editing, registers, people, found };
}
