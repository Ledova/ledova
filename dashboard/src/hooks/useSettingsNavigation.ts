import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appointmentForRegisterStep,
  canAdministerCompany,
  canOpen,
  COMPANIES_QUERY_KEY,
  OWN_APPOINTMENTS_QUERY_KEY,
  DESTINATIONS,
  getCompanies,
  getOwnMemberRecords,
  ownMemberRecordsKey,
  readEveryPage,
  USER_PREFERENCES_QUERY_KEY,
  useSubmissionOwner,
  useUserPreferences,
  CACHE_TIMING,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { SETTINGS_VIEWS } from '@utils/destinations';
import { ownAppointmentsKey, useOwnAppointments } from './useOwnAppointments';

export function useSettingsNavigation() {
  const { owner, boundary } = useSubmissionOwner();
  const client = useQueryClient();
  const preferences = useUserPreferences();
  const companyAudience = !!preferences.userAccount && canOpen(preferences.userAccount.role, 'company');
  const guard = () => {
    if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed.');
  };
  const appointments = useOwnAppointments(owner!, guard, {
    queryKey: owner ? ownAppointmentsKey(owner) : [...OWN_APPOINTMENTS_QUERY_KEY, null],
    enabled: !!owner,
    coordinatedReads: true,
    passive: true,
  });
  const companies = useQuery({
    queryKey: [...COMPANIES_QUERY_KEY, owner?.userUuid, owner?.ownerAccountUuid, 'settings-navigation'],
    enabled: !!owner && companyAudience,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
    refetchOnMount: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanies(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
  });
  const members = useQuery({
    queryKey: ownMemberRecordsKey(owner),
    enabled: !!owner && !!preferences.preferences && !preferences.isError && !preferences.isFetching,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
    refetchOnMount: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: () =>
      readEveryPage(async (page) => {
        const check = () => {
          guard();
          const state = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
          if (state?.status !== 'success' || state.fetchStatus !== 'idle')
            throw new Error('Your signed-in account changed.');
        };
        check();
        const result = await getOwnMemberRecords(apiClient, page, { ledovaSubmissionGuard: check });
        check();
        return result;
      }),
  });
  const current = !!owner && !!preferences.preferences && !preferences.isError && !preferences.isFetching;
  const own = current && appointments.isSuccess && !appointments.isFetching ? appointments.data : [];
  const companyRows = current && companyAudience && companies.isSuccess && !companies.isFetching ? companies.data : [];
  const canActivate = own.some(
    (appointment) =>
      appointment.capabilities.includes('admin') &&
      !appointment.revokedAt &&
      !!appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
  );
  const hasOwnedCompany = companyRows.some((company) => company.isOwner === true);
  const canManageCompany = canActivate || companyRows.some(canAdministerCompany) || hasOwnedCompany;
  const canReviewEligibility =
    canManageCompany ||
    own.some(
      (appointment) =>
        !appointment.revokedAt &&
        (appointmentForRegisterStep([appointment], appointment.company, 'prepare') ||
          appointmentForRegisterStep([appointment], appointment.company, 'approve')),
    );
  const hasMemberRecords = current && members.isSuccess && members.data.length > 0;
  const items = SETTINGS_VIEWS.filter(({ key }) => {
    if (key === 'company' || key === 'company-documents') return canManageCompany;
    if (key === 'activation') return canActivate;
    if (key === 'company-recorded-details') return hasMemberRecords || members.isError;
    return true;
  });
  return {
    defaultPath: canActivate ? DESTINATIONS.company.path : `${DESTINATIONS.settings.path}#account`,
    isLoading:
      !owner ||
      preferences.isLoading ||
      preferences.isFetching ||
      appointments.isPending ||
      appointments.isFetching ||
      (companyAudience && (companies.isPending || companies.isFetching)),
    isError: preferences.isError || appointments.isError || (companyAudience && companies.isError),
    isFetching:
      preferences.isFetching ||
      appointments.isFetching ||
      (companyAudience && companies.isFetching) ||
      members.isFetching,
    retry: async () => {
      const refreshed = await preferences.refetch();
      if (refreshed.isError || !owner || boundary.get() !== owner) return;
      await Promise.all([appointments.refetch(), ...(companyAudience ? [companies.refetch()] : []), members.refetch()]);
    },
    items,
    canManageCompany,
    canActivate,
    hasOwnedCompany,
    hasMemberRecords,
    canReviewEligibility,
  };
}
