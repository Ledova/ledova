import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { COMPANY_AUTHORITY_CAPABILITIES, canOpen } from '../constants';
import { getCompanies, getCompany } from '../services/companies';
import type { Company, CompanyListItem, UserPreferences } from '../types';
import { readEveryPage } from '../utils/pagination';
import { createUserFriendlyError } from '../utils/errors';
import { AUTH_QUERY_KEY } from './useAuth';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './useUserPreferences';

export function canAdministerCompany(company: Company | CompanyListItem) {
  const access = company.administrativeAccess;
  if (
    !access ||
    typeof access.draftSetup !== 'boolean' ||
    typeof company.isOwner !== 'boolean' ||
    !Array.isArray(access.capabilities) ||
    new Set(access.capabilities).size !== access.capabilities.length ||
    access.capabilities.some((value) => !COMPANY_AUTHORITY_CAPABILITIES.some((item) => item.value === value))
  )
    return false;
  return (access.draftSetup && company.isOwner && company.status === 'draft') || access.capabilities.includes('admin');
}

export function canPersonallyAdministerCompany(company: Company | CompanyListItem) {
  return canAdministerCompany(company) && company.administrativeAccess.capabilities.includes('admin');
}

export function useCompanySelection(
  apiClient: AxiosInstance,
  {
    ownedOnly = false,
    personalOnly = false,
    session,
  }: { ownedOnly?: boolean; personalOnly?: boolean; session?: OrderSubmissionSession } = {},
) {
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const preferences = useUserPreferences();
  const id = useId();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scope = useRef({ owner, generation: 0 });
  if (scope.current.owner !== owner) scope.current = { owner, generation: scope.current.generation + 1 };
  const scopeKey = `${id}/${scope.current.generation}`;
  const [selection, setSelection] = useState<{ scope: string; uuid: string } | null>(null);
  const ownerBusiness = !!preferences.userAccount?.role && canOpen(preferences.userAccount.role, 'company');
  const enabled = !!owner && !preferences.isError && (!ownedOnly || ownerBusiness);
  const readable = (item: Company | CompanyListItem) =>
    personalOnly
      ? canPersonallyAdministerCompany(item)
      : ownedOnly
        ? item.isOwner === true
        : canAdministerCompany(item) || (ownerBusiness && item.isOwner === true);
  const ownerGuard = () => {
    if (
      !mounted.current ||
      !owner ||
      boundary.get() !== owner ||
      client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status !== 'success'
    )
      throw createUserFriendlyError('Your signed-in account changed. Reopen company information.');
  };
  const companiesKey = ['companies', owner?.userUuid, owner?.ownerAccountUuid, scopeKey, ownedOnly, personalOnly];
  const companies = useQuery({
    queryKey: companiesKey,
    enabled,
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        ownerGuard();
        const result = await getCompanies(apiClient, page, {
          ...session?.requestConfig(),
          signal,
          ledovaSubmissionGuard: ownerGuard,
        });
        ownerGuard();
        return result;
      });
      const seen = new Set<string>();
      for (const item of rows) {
        if (!item.uuid || seen.has(item.uuid))
          throw createUserFriendlyError('The company list could not be confirmed.');
        seen.add(item.uuid);
      }
      return rows;
    },
  });
  const choices = enabled ? (companies.data ?? []).filter(readable) : [];
  const selected = selection?.scope === scopeKey ? selection.uuid : undefined;
  const initial = selected === undefined && companies.isSuccess && choices.length === 1 ? choices[0]!.uuid : '';
  const uuid = selected ?? initial;
  const selectedCompany = choices.find((item) => item.uuid === uuid);
  const companyUuid = selectedCompany?.uuid;
  const selectedRef = useRef(companyUuid);
  selectedRef.current = companyUuid;
  useEffect(() => {
    if (enabled && companies.isSuccess && selection?.scope !== scopeKey)
      setSelection({ scope: scopeKey, uuid: initial });
  }, [companies.isSuccess, enabled, initial, scopeKey, selection?.scope]);
  const companyKey = ['company', companyUuid, owner?.userUuid, owner?.ownerAccountUuid, scopeKey];
  const detail = useQuery({
    queryKey: companyKey,
    enabled: enabled && !!companyUuid && !companies.isError,
    queryFn: async ({ signal }) => {
      const guard = () => {
        ownerGuard();
        if (selectedRef.current !== companyUuid) throw createUserFriendlyError('The selected company changed.');
      };
      guard();
      const { data } = await getCompany(apiClient, companyUuid!, {
        ...session?.requestConfig(),
        signal,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (data.uuid !== companyUuid || !readable(data))
        throw createUserFriendlyError('The company information or your authority changed. Refresh before continuing.');
      if (
        !Array.isArray(data.documents) ||
        data.documents.some((document) => document.company !== companyUuid) ||
        new Set(data.documents.map((document) => document.uuid)).size !== data.documents.length
      )
        throw createUserFriendlyError('The company documents could not be confirmed.');
      return data;
    },
  });
  const error = preferences.error || companies.error || (companyUuid ? detail.error : null);
  const administration =
    !!detail.data && !!selectedCompany && canAdministerCompany(detail.data) && canAdministerCompany(selectedCompany);
  const personalAdministration =
    !!detail.data &&
    !!selectedCompany &&
    canPersonallyAdministerCompany(detail.data) &&
    canPersonallyAdministerCompany(selectedCompany);
  const retainedCompany =
    enabled && companyUuid && detail.data
      ? {
          ...detail.data,
          isOwner: detail.data.isOwner === true && selectedCompany?.isOwner === true,
          ...(!personalAdministration && { activation: null }),
          ...(!administration && {
            administrativeAccess:
              selectedCompany && !canAdministerCompany(selectedCompany)
                ? selectedCompany.administrativeAccess
                : detail.data.administrativeAccess,
            documents: [],
            email: null,
            primaryContact: null,
          }),
        }
      : null;
  const company = !error ? retainedCompany : null;
  const isRefreshing = preferences.isFetching || companies.isFetching || detail.isFetching;
  const assertCurrent = (targetUuid: string, mode: 'admin' | 'owner' | 'personal' = 'admin') => {
    ownerGuard();
    const current = client.getQueryData<Company>(companyKey);
    const list = client.getQueryData<CompanyListItem[]>(companiesKey);
    const listed = list?.find((item) => item.uuid === targetUuid);
    const role = client.getQueryData<{ data: UserPreferences }>(USER_PREFERENCES_QUERY_KEY)?.data.userAccount?.role;
    for (const key of [AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY, companiesKey, companyKey]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh company information before continuing.');
    }
    if (
      selectedRef.current !== targetUuid ||
      current?.uuid !== targetUuid ||
      !listed ||
      (mode === 'personal'
        ? !canPersonallyAdministerCompany(current) || !canPersonallyAdministerCompany(listed)
        : mode === 'admin'
          ? !canAdministerCompany(current) || !canAdministerCompany(listed)
          : current.isOwner !== true || listed.isOwner !== true || !role || !canOpen(role, 'company'))
    )
      throw createUserFriendlyError('Your company or authority changed. Reopen this action.');
  };
  return {
    company,
    retainedCompany,
    companyUuid,
    companies: choices,
    selectionBlocked: !enabled || companies.isFetching || companies.isError || preferences.isFetching,
    selectCompany: (next: string) => {
      selectedRef.current = choices.some((item) => item.uuid === next) ? next : undefined;
      setSelection({ scope: scopeKey, uuid: next });
    },
    scopeKey,
    ownerBusiness: company?.isOwner === true && selectedCompany?.isOwner === true && ownerBusiness,
    canAdmin: !!company && !error && !isRefreshing && administration,
    canPersonalAdmin: !!company && !error && !isRefreshing && personalAdministration,
    companyKey,
    companiesKey,
    assertCurrent,
    requestConfig: (targetUuid: string, mode: 'admin' | 'owner' | 'personal' = 'admin') => ({
      ...session?.requestConfig(),
      ledovaSubmissionGuard: () => assertCurrent(targetUuid, mode),
    }),
    isLoading: enabled && (companies.isPending || (!!companyUuid && detail.isPending)),
    isRefreshing,
    error,
    refetch: () =>
      Promise.all([
        ...(preferences.isError ? [preferences.refetch()] : []),
        companies.refetch(),
        ...(companyUuid ? [detail.refetch()] : []),
      ]),
  };
}
