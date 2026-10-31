import { useQuery } from '@tanstack/react-query';
import {
  appointmentForRegisterStep,
  canAdministerCompany,
  canOpen,
  ownCompaniesKey,
  OWN_APPOINTMENTS_QUERY_KEY,
  DESTINATIONS,
  getCompanies,
  readEveryPage,
  useSubmissionOwner,
  useUserPreferences,
  CACHE_TIMING,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { SETTINGS_VIEWS } from '@utils/destinations';
import { ownAppointmentsKey, useOwnAppointments } from './useOwnAppointments';

export function useSettingsNavigation() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const companyAudience = !!preferences.userAccount && canOpen(preferences.userAccount.role, 'company');
  const guard = () => {
    if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed.');
  };
  const appointments = useOwnAppointments(owner!, guard, {
    queryKey: owner ? ownAppointmentsKey(owner) : [...OWN_APPOINTMENTS_QUERY_KEY, null],
    enabled: !!owner,
    passive: true,
  });
  const companies = useQuery({
    queryKey: [...ownCompaniesKey(owner), 'settings-navigation'],
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
  const current = !!owner && !!preferences.preferences && !preferences.isError;
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
  const items = SETTINGS_VIEWS.filter(({ key }) => key !== 'activation' || canActivate);
  return {
    defaultPath: `${DESTINATIONS.settings.path}#profile`,
    isLoading:
      !owner ||
      preferences.isLoading ||
      appointments.isPending ||
      appointments.isFetching ||
      (companyAudience && (companies.isPending || companies.isFetching)),
    isError: preferences.isError || appointments.isError || (companyAudience && companies.isError),
    isFetching: preferences.isFetching || appointments.isFetching || (companyAudience && companies.isFetching),
    retry: async () => {
      const refreshed = await preferences.refetch();
      if (refreshed.isError || !owner || boundary.get() !== owner) return;
      await Promise.all([appointments.refetch(), ...(companyAudience ? [companies.refetch()] : [])]);
    },
    items,
    canManageCompany,
    hasOwnedCompany,
  };
}
