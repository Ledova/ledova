import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  COMPANIES_QUERY_KEY,
  OWN_APPOINTMENTS_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  appointmentForRegisterStep,
  canAdministerCompany,
  getCompanies,
  getOwnMemberRecords,
  hasCurrentRegisterReadAuthority,
  ownMemberRecordsKey,
  readEveryPage,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnMemberRecord,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { ownAppointmentsKey, useOwnAppointments } from './useOwnAppointments';

export interface OwnershipCompany {
  uuid: string;
  name: string;
  memberUuids: string[];
  canReadRegister: boolean;
  canManage: boolean;
  canReviewEligibility: boolean;
  isOwner: boolean;
  status?: string;
}

export function ownershipCompaniesKey(owner: OrderSubmissionOwner | null) {
  return [...COMPANIES_QUERY_KEY, owner?.userUuid, owner?.ownerAccountUuid, 'ownership-browser'];
}

function confirmedMemberRows(rows: OwnMemberRecord[]) {
  return (
    new Set(rows.map(({ uuid }) => uuid)).size === rows.length &&
    new Set(rows.map((row) => row.company.uuid)).size === rows.length &&
    rows.every((row) => row.uuid && row.member && row.company.uuid && row.identitySource === 'company_recorded')
  );
}

export function useOwnershipCompanies() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const client = useQueryClient();
  const ready = !!owner && !!preferences.preferences && !preferences.isError && !preferences.isFetching;
  const guard = () => {
    const current = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (!owner || boundary.get() !== owner || current?.status !== 'success' || current.fetchStatus !== 'idle')
      throw new Error('Your signed-in account changed. Reopen your companies.');
  };
  const timing = {
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
  const companyRows = useQuery({
    queryKey: ownershipCompaniesKey(owner),
    enabled: ready,
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const result = await getCompanies(apiClient, page, { signal, ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (new Set(rows.map(({ uuid }) => uuid)).size !== rows.length || rows.some(({ uuid }) => !uuid))
        throw new Error('Your company list could not be confirmed.');
      return rows;
    },
    ...timing,
  });
  const appointments = useOwnAppointments(owner!, guard, {
    queryKey: owner ? ownAppointmentsKey(owner) : [...OWN_APPOINTMENTS_QUERY_KEY, null],
    enabled: ready,
    coordinatedReads: true,
  });
  const memberRows = useQuery({
    queryKey: ownMemberRecordsKey(owner),
    enabled: ready,
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const result = await getOwnMemberRecords(apiClient, page, { signal, ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (!confirmedMemberRows(rows)) throw new Error('Your member associations could not be confirmed.');
      return rows;
    },
    ...timing,
  });
  const isRefreshing =
    preferences.isFetching || companyRows.isFetching || appointments.isFetching || memberRows.isFetching;
  const hasError =
    preferences.isError ||
    companyRows.isError ||
    appointments.isError ||
    memberRows.isError ||
    (memberRows.isSuccess && !confirmedMemberRows(memberRows.data));
  const confirmed =
    ready && !isRefreshing && !hasError && companyRows.isSuccess && appointments.isSuccess && memberRows.isSuccess;
  const companies = new Map<string, OwnershipCompany>();
  const members: OwnMemberRecord[] = confirmed ? memberRows.data : [];
  if (confirmed) {
    for (const company of companyRows.data) {
      companies.set(company.uuid, {
        uuid: company.uuid,
        name: company.name,
        memberUuids: [],
        canReadRegister: company.isOwner === true || hasCurrentRegisterReadAuthority(appointments.data, company.uuid),
        canManage: canAdministerCompany(company),
        canReviewEligibility:
          canAdministerCompany(company) ||
          !!appointmentForRegisterStep(appointments.data, company.uuid, 'prepare') ||
          !!appointmentForRegisterStep(appointments.data, company.uuid, 'approve'),
        isOwner: company.isOwner === true,
        status: company.status,
      });
    }
    for (const appointment of appointments.data) {
      if (!appointment.isEffective || appointment.status !== 'active' || appointment.revokedAt) continue;
      if (!companies.has(appointment.company))
        companies.set(appointment.company, {
          uuid: appointment.company,
          name: appointment.companyName,
          memberUuids: [],
          canReadRegister: hasCurrentRegisterReadAuthority(appointments.data, appointment.company),
          canManage: appointment.capabilities.includes('admin'),
          canReviewEligibility:
            !!appointmentForRegisterStep(appointments.data, appointment.company, 'prepare') ||
            !!appointmentForRegisterStep(appointments.data, appointment.company, 'approve'),
          isOwner: false,
          status: appointment.companyStatus,
        });
    }
    for (const member of members) {
      const company = companies.get(member.company.uuid) ?? {
        uuid: member.company.uuid,
        name: member.company.name,
        memberUuids: [],
        canReadRegister: false,
        canManage: false,
        canReviewEligibility: false,
        isOwner: false,
      };
      company.memberUuids.push(member.uuid);
      companies.set(company.uuid, company);
    }
  }
  return {
    owner,
    companies: [...companies.values()].sort((left, right) => left.name.localeCompare(right.name)),
    members,
    isLoading:
      preferences.isLoading || (!!owner && (companyRows.isPending || appointments.isPending || memberRows.isPending)),
    hasError,
    isRefreshing,
    retry: async () => {
      const refreshed = await preferences.refetch();
      if (refreshed.isError || !owner || boundary.get() !== owner) return;
      await Promise.all([companyRows.refetch(), appointments.refetch(), memberRows.refetch()]);
    },
  };
}
