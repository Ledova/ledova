import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  admitCompanyAuthorityRequest,
  getCompanyAuthorityRequests,
  getOwnCompanyAppointments,
  submitCompanyAuthorityRequest,
  withdrawCompanyAuthorityRequest,
} from '../services/company-authority';
import type { CompanyAuthorityRequest, Company, UserProfile } from '../types';
import { getErrorMessage } from '../utils/errors';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './useUserPreferences';

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
  const [authorityEvidence, setEvidence] = useState<Blob | null>(null);
  const [authorityAccepted, setAccepted] = useState(false);
  const [allowTeamDelegation, setDelegation] = useState(false);
  const [evidenceLocked, setEvidenceLocked] = useState(false);
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
    setEvidence(null);
    setAccepted(false);
    setDelegation(false);
    setEvidenceLocked(false);
  }, [owner, company?.uuid]);
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
  const authorityReady = sourceAvailable && !!authority.data?.appointment;
  const stopped = !authorityReady && authority.data?.requests.some((request) => request.status === 'admitted');
  const authorityError =
    enabled && !owner && !preferences.isLoading
      ? 'Your session is unavailable. Sign in again to resume company setup.'
      : enabled && preferences.isError
        ? 'Your signed-in account could not be checked. Reload company setup.'
        : authority.isError
          ? getErrorMessage(authority.error, 'Your administrator access could not be checked. Reload company setup.')
          : stopped
            ? 'Your initial administrator appointment is no longer current. Another initial declaration cannot restore it.'
            : authorityRequest && !authorityRequest.requestedCapabilities.includes('admin')
              ? 'This request does not include administrator access. Use different evidence to replace the pending request.'
              : null;
  const canEstablishAuthority =
    enabled &&
    !!owner &&
    authority.isSuccess &&
    !authority.isFetching &&
    !authorityError &&
    (authorityReady || (authorityAccepted && (!!authorityRequest || !!authorityEvidence)));
  const establishAuthority = async () => {
    guard();
    if (!canEstablishAuthority) throw new Error('Confirm your administrator authority before finishing company setup.');
    let state = await read();
    if (state.appointment) return;
    if (state.requests.some((request) => request.status === 'admitted'))
      throw new Error('Your initial administrator access is no longer current. Reload company setup.');
    let request: CompanyAuthorityRequest | undefined = state.requests.find((entry) => entry.status === 'pending');
    if (!authorityAccepted) throw new Error('Accept the authorisation declaration to continue.');
    if (!request) {
      if (!authorityEvidence) throw new Error('Choose a supporting document for your authority.');
      key.current ??= newKey();
      setEvidenceLocked(true);
      try {
        const response = await submitCompanyAuthorityRequest(
          apiClient,
          {
            company: company!.uuid,
            file: authorityEvidence,
            idempotencyKey: key.current,
            requestedCapabilities: ['admin'],
            delegatableCapabilities: allowTeamDelegation ? ['admin'] : [],
          },
          { ledovaSubmissionGuard: guard },
        );
        guard();
        request = response.data;
      } catch (error) {
        guard();
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) setEvidenceLocked(false);
        throw error;
      }
    }
    if (request.company !== company!.uuid || !request.requestedCapabilities.includes('admin'))
      throw new Error('Your authority request did not match this company administrator setup.');
    const response = await admitCompanyAuthorityRequest(apiClient, request.uuid, { ledovaSubmissionGuard: guard });
    guard();
    if (response.data.uuid !== request.uuid || response.data.status !== 'admitted')
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
      setEvidence(null);
      setAccepted(false);
      setEvidenceLocked(false);
      await authority.refetch({ throwOnError: true });
    },
  });
  const setAuthorityEvidence = useCallback(
    (file: Blob | null) => {
      if (evidenceLocked || file === authorityEvidence) return;
      key.current = null;
      setEvidence(file);
      setAccepted(false);
    },
    [authorityEvidence, evidenceLocked],
  );
  const setAllowTeamDelegation = (value: boolean) => {
    if (evidenceLocked) return;
    key.current = null;
    setDelegation(value);
    setAccepted(false);
  };
  return {
    authorityRequest,
    authorityReady,
    authorityLoading: enabled && (preferences.isLoading || authority.isLoading),
    authorityError: reset.isError
      ? getErrorMessage(reset.error, 'Your pending authority request could not be replaced.')
      : authorityError,
    authorityEvidence,
    authorityEvidenceLocked: evidenceLocked,
    setAuthorityEvidence,
    authorityAccepted,
    setAuthorityAccepted: setAccepted,
    allowTeamDelegation,
    setAllowTeamDelegation,
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
