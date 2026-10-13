import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  acceptCompanySignupTerms,
  admitCompanyAuthorityRequest,
  getCompanyAuthorityRequests,
  getOwnCompanyAppointments,
  submitCompanyAuthorityRequest,
  withdrawCompanyAuthorityRequest,
} from '../services/company-authority';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_SIGNUP_DECLARATION,
  COMPANY_SIGNUP_DECLARATION_VERSION,
} from '../constants/business/company-authority';
import type { CompanyAuthorityRequest, Company, CompanyCapability, OwnCompanyAppointment, UserProfile } from '../types';
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

function currentAdministrator(appointment: OwnCompanyAppointment, company: string) {
  return (
    appointment.company === company &&
    appointment.status === 'active' &&
    appointment.isEffective &&
    appointment.capabilities.includes('admin') &&
    (!appointment.expiresAt || Date.parse(appointment.expiresAt) > Date.now())
  );
}

function sameAppointment(left: OwnCompanyAppointment, right: OwnCompanyAppointment) {
  return (
    left.uuid === right.uuid &&
    left.company === right.company &&
    left.source === right.source &&
    left.declarationVersion === right.declarationVersion &&
    left.declarationText === right.declarationText &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    JSON.stringify([...left.capabilities].sort()) === JSON.stringify([...right.capabilities].sort()) &&
    JSON.stringify([...left.delegatableCapabilities].sort()) ===
      JSON.stringify([...right.delegatableCapabilities].sort())
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
    const appointment = appointments.find((entry) => currentAdministrator(entry, company!.uuid));
    return { requests, appointments, appointment };
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
  const authorityReady = sourceAvailable && !!authority.data?.appointment;
  const stopped =
    !authorityReady &&
    (authority.data?.requests.some((request) => request.status === 'admitted') ||
      authority.data?.appointments.some(
        (appointment) => appointment.company === company?.uuid && appointment.capabilities.includes('admin'),
      ));
  const authorityError =
    enabled && !owner && !preferences.isLoading
      ? 'Your session is unavailable. Sign in again to resume company setup.'
      : enabled && preferences.isError
        ? 'Your signed-in account could not be checked. Reload company setup.'
        : authority.isError
          ? getErrorMessage(authority.error, 'Your administrator access could not be checked. Reload company setup.')
          : stopped
            ? 'Your company administrator appointment is no longer current. Another initial declaration cannot restore it.'
            : !authorityReady && authorityRequest && !authorityRequest.requestedCapabilities.includes('admin')
              ? 'This saved setup does not include administrator access. Update the saved setup to continue.'
              : !authorityReady &&
                  authorityRequest?.requestedExpiresAt &&
                  !(Date.parse(authorityRequest.requestedExpiresAt) > Date.now())
                ? 'Your saved setup has expired. Update the saved setup to continue.'
                : null;
  const currentTerms = (appointment: OwnCompanyAppointment) => {
    const receipt = appointment.signupTerms;
    return (
      receipt?.company === company!.uuid &&
      receipt.appointment === appointment.uuid &&
      receipt.acceptedProfile === profile!.uuid &&
      !!receipt.acceptedBy &&
      receipt.declarationVersion === COMPANY_SIGNUP_DECLARATION_VERSION &&
      receipt.declarationText === COMPANY_SIGNUP_DECLARATION &&
      Number.isFinite(Date.parse(receipt.acceptedAt))
    );
  };
  const confirmTerms = async (appointment: OwnCompanyAppointment) => {
    guard();
    if (!currentAdministrator(appointment, company!.uuid))
      throw new Error('Your company administrator appointment is no longer current. Refresh company setup.');
    if (!currentTerms(appointment)) {
      const response = await acceptCompanySignupTerms(apiClient, appointment.uuid, { ledovaSubmissionGuard: guard });
      guard();
      if (
        !sameAppointment(appointment, response.data) ||
        !currentAdministrator(response.data, company!.uuid) ||
        !currentTerms(response.data)
      )
        throw new Error(
          'Your current company Terms acceptance could not be confirmed. Refresh company setup before retrying.',
        );
    }
    const confirmed = await authority.refetch({ throwOnError: true });
    guard();
    if (
      !confirmed.data?.appointment ||
      !sameAppointment(appointment, confirmed.data.appointment) ||
      !currentAdministrator(confirmed.data.appointment, company!.uuid) ||
      !currentTerms(confirmed.data.appointment)
    )
      throw new Error(
        'Your current company authority and Terms acceptance could not be confirmed. Refresh company setup before retrying.',
      );
  };
  const canEstablishAuthority = enabled && !!owner && authority.isSuccess && !authority.isFetching && !authorityError;
  const establishAuthority = async () => {
    guard();
    if (!canEstablishAuthority) throw new Error('Company setup is not ready. Reload it before continuing.');
    let state = await read();
    if (state.appointment) {
      await confirmTerms(state.appointment);
      return;
    }
    if (
      state.requests.some((request) => request.status === 'admitted') ||
      state.appointments.some(
        (appointment) => appointment.company === company!.uuid && appointment.capabilities.includes('admin'),
      )
    )
      throw new Error('Your initial administrator access is no longer current. Reload company setup.');
    let request: CompanyAuthorityRequest | undefined = state.requests.find((entry) => entry.status === 'pending');
    const newRequest = !request;
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
      !request.requestedCapabilities.includes('admin') ||
      (newRequest &&
        !signupScopes(request.requestedCapabilities, request.delegatableCapabilities, request.requestedExpiresAt))
    )
      throw new Error('Your authority request did not match this company administrator setup.');
    const response = await admitCompanyAuthorityRequest(apiClient, request.uuid, { ledovaSubmissionGuard: guard });
    guard();
    if (response.data.uuid !== request.uuid || response.data.status !== 'admitted' || !response.data.appointment)
      throw new Error('Administrator access could not be confirmed. Reload company setup before retrying.');
    state = await read();
    if (
      !state.appointment ||
      state.appointment.uuid !== response.data.appointment.uuid ||
      state.appointment.expiresAt !== (request.requestedExpiresAt ?? null) ||
      JSON.stringify([...state.appointment.capabilities].sort()) !==
        JSON.stringify([...request.requestedCapabilities].sort()) ||
      JSON.stringify([...state.appointment.delegatableCapabilities].sort()) !==
        JSON.stringify([...request.delegatableCapabilities].sort())
    )
      throw new Error(
        'Your administrator appointment did not match the retained setup. Reload company setup before retrying.',
      );
    await confirmTerms(state.appointment);
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
