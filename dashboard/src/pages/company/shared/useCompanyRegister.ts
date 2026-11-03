import { useQuery } from '@tanstack/react-query';
import {
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  registerHoldersKey,
  registersQuery,
  useOwnAppointments,
  useRegisterClasses,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useCompanyRegister(
  owner: OrderSubmissionOwner,
  guard: () => void,
  retained?: { company: { uuid: string; name: string }; tokens: string[] },
  includeEmptyCompanies = false,
  requestedCompany?: string,
  requestedToken?: string,
) {
  const classes = useRegisterClasses(owner, guard);
  const listed = classes.data ?? [];
  const appointments = useOwnAppointments(owner, guard, { enabled: includeEmptyCompanies });
  const extra =
    includeEmptyCompanies && appointments.isSuccess
      ? appointments.data
          .filter((item) => hasCurrentRegisterReadAuthority([item], item.company))
          .map((item) => [item.company, item.companyName] as const)
      : [];
  const companies = [
    ...new Map([...listed.map((item) => [item.companyUuid, item.companyName] as const), ...extra]).entries(),
  ].map(([uuid, name]) => ({ uuid, name }));
  const tokenCompany = requestedToken ? listed.find(({ uuid }) => uuid === requestedToken)?.companyUuid : undefined;
  const wanted = requestedToken
    ? tokenCompany && (!requestedCompany || tokenCompany === requestedCompany)
      ? tokenCompany
      : ''
    : requestedCompany;
  const company =
    retained?.company ??
    (wanted !== undefined
      ? companies.find(({ uuid }) => uuid === wanted)
      : companies.length === 1
        ? companies[0]
        : undefined);
  const uuids = retained?.tokens ?? listed.filter((item) => item.companyUuid === company?.uuid).map(({ uuid }) => uuid);
  const empty = includeEmptyCompanies && !!company && uuids.length === 0;
  const registers = useQuery({
    ...registersQuery(apiClient, owner, uuids, guard),
    ...(empty
      ? {
          queryKey: [...registerHoldersKey(owner), 'empty', company.uuid],
          enabled: true,
          queryFn: async () => {
            guard();
            return [];
          },
        }
      : {}),
  });
  return {
    classes,
    companies,
    company,
    registers,
    companyAppointments: appointments,
  };
}
