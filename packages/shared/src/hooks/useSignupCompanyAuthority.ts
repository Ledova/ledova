import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  admitCompanyAuthorityRequest,
  getCompanyAuthorityRequests,
  getOwnCompanyAppointments,
  submitCompanyAuthorityRequest,
  withdrawCompanyAuthorityRequest,
} from '../services/company-authority';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_SIGNUP_DECLARATION_VERSION,
} from '../constants/business/company-authority';
import type { CompanyAuthorityRequest, Company, CompanyCapability, UserProfile } from '../types';
import { getErrorMessage } from '../utils/errors';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './useUserPreferences';

function signupScopes(capabilities: CompanyCapability[], delegatable: CompanyCapability[], expiresAt?: string | null) {
  return (
    capabilities.length === 1 &&
    capabilities[0] === 'admin' &&
    delegatable.length === COMPANY_AUTHORITY_CAPABILITIES.length &&
    COMPANY_AUTHORITY_CAPABILITIES.every(({ value }) => delegatable.includes(value)) &&
    !expiresAt
  );
}

export function useSignupCompanyAuthority(
  company: Company | null,
  profile: UserProfile | null,
  enabled: boolean,
  session?: OrderSubmissionSession,
  newKey: () => string = () => crypto.randomUUID(),
) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const preferences = useUserPreferences();
  const key = useRef<string | null>(null);
  const current = useRef({ company, profile });
  current.current = { company, profile };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    key.current = null;
  }, [
    owner,
    company?.uuid,
    company?.name,
    company?.acn,
    company?.abn,
    company?.companyType,
    profile?.uuid,
    profile?.fullName,
  ]);
  const guardSession = useCallback(() => {
    if (
      !owner ||
      boundary.get() !== owner ||
      client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status === 'error' ||
      !profile ||
      profile.uuid !== owner.userUuid ||
      current.current.profile?.uuid !== profile.uuid ||
      current.current.profile.fullName !== profile.fullName
    )
      throw new Error('Your signed-in account changed. Sign in again to resume signup.');
  }, [owner, boundary, client, profile]);
  const guardCompany = useCallback(() => {
    guardSession();
    if (
      !company ||
      current.current.company?.uuid !== company.uuid ||
      current.current.company.name !== company.name ||
      current.current.company.acn !== company.acn ||
      current.current.company.abn !== company.abn ||
      current.current.company.companyType !== company.companyType
    )
      throw new Error('Your account or company details changed. Reload company setup to continue.');
  }, [guardSession, company]);
  const guard = useCallback(() => {
    if (!mounted.current) throw new Error('Company setup is no longer open. Reload it before continuing.');
    guardCompany();
  }, [guardCompany]);
  const read = useCallback(async () => {
    guard();
    const [requests, appointments] = await Promise.all([
      readEveryPage(async (page) => {
        guard();
        const response = await getCompanyAuthorityRequests(apiClient, company!.uuid, page, {
          ledovaSubmissionGuard: guard,
        });
        guard();
        if (response.data.results.some((request) => request.company !== company!.uuid))
          throw new Error('Your authority records did not match this company. Reload company setup.');
        return response;
      }),
      readEveryPage(async (page) => {
        guard();
        const response = await getOwnCompanyAppointments(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return response;
      }),
    ]);
    guard();
    const appointment = appointments.find(
      (entry) =>
        entry.company === company!.uuid &&
        entry.status === 'active' &&
        entry.isEffective &&
        entry.capabilities.includes('admin'),
    );
    return { requests, appointment };
  }, [apiClient, company, guard]);
  const authority = useQuery({
    queryKey: ['signup', 'authority', owner?.userUuid, owner?.ownerAccountUuid, company?.uuid],
    queryFn: read,
    enabled: enabled && !!owner && !!company && profile?.uuid === owner.userUuid,
    staleTime: 0,
  });
  const sourceAvailable = enabled && !!owner && !preferences.isError && !authority.isError;
  const authorityRequest = sourceAvailable
    ? (authority.data?.requests.find((request) => request.status === 'pending') ?? null)
    : null;
  const currentAppointment = authority.data?.appointment;
  const currentSignupAppointment =
    currentAppointment?.declarationVersion === COMPANY_SIGNUP_DECLARATION_VERSION &&
    signupScopes(
      currentAppointment.capabilities,
      currentAppointment.delegatableCapabilities,
      currentAppointment.expiresAt,
    );
  const authorityReady = sourceAvailable && !!currentSignupAppointment;
  const stopped = !authorityReady && authority.data?.requests.some((request) => request.status === 'admitted');
  const authorityError =
    enabled && !owner && !preferences.isLoading
      ? 'Your session is unavailable. Sign in again to resume company setup.'
      : enabled && preferences.isError
        ? 'Your signed-in account could not be checked. Reload company setup.'
        : authority.isError
          ? getErrorMessage(authority.error, 'Your administrator access could not be checked. Reload company setup.')
          : currentAppointment && !currentSignupAppointment
            ? 'Your saved appointment uses earlier signup terms or permissions. It cannot be replaced by another initial declaration. Contact the deployment operator to complete this older setup.'
            : stopped
              ? 'Your initial administrator appointment is no longer current. Another initial declaration cannot restore it.'
              : authorityRequest &&
                  !signupScopes(
                    authorityRequest.requestedCapabilities,
                    authorityRequest.delegatableCapabilities,
                    authorityRequest.requestedExpiresAt,
                  )
                ? 'This saved setup uses previous permissions or an expiry. Update the saved setup to continue.'
                : null;
  const canEstablishAuthority = enabled && !!owner && authority.isSuccess && !authority.isFetching && !authorityError;
  const establishAuthority = async () => {
    guard();
    if (!canEstablishAuthority) throw new Error('Company setup is not ready. Reload it before continuing.');
    let state = await read();
    if (state.appointment) {
      if (
        state.appointment.declarationVersion !== COMPANY_SIGNUP_DECLARATION_VERSION ||
        !signupScopes(
          state.appointment.capabilities,
          state.appointment.delegatableCapabilities,
          state.appointment.expiresAt,
        )
      )
        throw new Error('Your saved appointment does not match this company setup. Reload company setup to continue.');
      return;
    }
    if (state.requests.some((request) => request.status === 'admitted'))
      throw new Error('Your initial administrator access is no longer current. Reload company setup.');
    let request: CompanyAuthorityRequest | undefined = state.requests.find((entry) => entry.status === 'pending');
    if (!request) {
      key.current ??= newKey();
      try {
        const response = await submitCompanyAuthorityRequest(
          apiClient,
          {
            company: company!.uuid,
            idempotencyKey: key.current,
            requestedCapabilities: ['admin'],
            delegatableCapabilities: COMPANY_AUTHORITY_CAPABILITIES.map(({ value }) => value),
          },
          { ledovaSubmissionGuard: guard },
        );
        guard();
        request = response.data;
      } catch (error) {
        guard();
        throw error;
      }
    }
    if (
      request.company !== company!.uuid ||
      !signupScopes(request.requestedCapabilities, request.delegatableCapabilities, request.requestedExpiresAt)
    )
      throw new Error('Your authority request did not match this company administrator setup.');
    const response = await admitCompanyAuthorityRequest(apiClient, request.uuid, { ledovaSubmissionGuard: guard });
    guard();
    if (
      response.data.uuid !== request.uuid ||
      response.data.status !== 'admitted' ||
      response.data.appointment?.declarationVersion !== COMPANY_SIGNUP_DECLARATION_VERSION ||
      !signupScopes(
        response.data.appointment.capabilities,
        response.data.appointment.delegatableCapabilities,
        response.data.appointment.expiresAt,
      )
    )
      throw new Error('Administrator access could not be confirmed. Reload company setup before retrying.');
    state = await read();
    if (!state.appointment || state.appointment.uuid !== response.data.appointment?.uuid)
      throw new Error('Your administrator appointment is not current. Reload company setup before retrying.');
    const confirmed = await authority.refetch({ throwOnError: true });
    guard();
    if (confirmed.data?.appointment?.uuid !== response.data.appointment?.uuid)
      throw new Error('Your administrator appointment is not current. Reload company setup before retrying.');
  };
  const reset = useMutation({
    mutationFn: async () => {
      guard();
      if (!authorityRequest || authorityRequest.status !== 'pending') return;
      const response = await withdrawCompanyAuthorityRequest(apiClient, authorityRequest.uuid, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (response.data.uuid !== authorityRequest.uuid || response.data.status !== 'withdrawn')
        throw new Error('The pending request could not be replaced. Reload company setup before retrying.');
      key.current = null;
      await authority.refetch({ throwOnError: true });
    },
  });
  return {
    authorityRequest,
    authorityReady,
    authorityLoading: enabled && (preferences.isLoading || authority.isLoading),
    authorityError: reset.isError
      ? getErrorMessage(reset.error, 'Your pending authority request could not be replaced.')
      : authorityError,
    resetAuthorityRequest: () => reset.mutateAsync(),
    isResettingAuthority: reset.isPending,
    canEstablishAuthority,
    establishAuthority,
    guardCompletion: enabled ? guardCompany : guardSession,
    guardCommandCompletion: () => {
      if (!mounted.current) throw new Error('Signup is no longer open. Reload it before continuing.');
      (enabled ? guardCompany : guardSession)();
    },
    completionOwnerReady: !!owner && profile?.uuid === owner.userUuid && !preferences.isError,
    clearAuthorityError: () => reset.reset(),
    refreshAuthority: () => authority.refetch({ throwOnError: true }),
  };
}
