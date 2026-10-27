import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import {
  apiErrorSentence,
  REGISTER_DEPLOYMENT_COPY as COPY,
  createUserFriendlyError,
  failureStatus,
  getRegisterDeployments,
  isPreparedRegisterDeployment,
  prepareRegisterDeployment,
  readEveryPage,
  refusalSentence,
  REGISTER_DEPLOYMENT_UNMET_COPY,
  type CompanyShareToken,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  COMPANY_QUERY_KEY,
  type RegisterDeployment,
  type RegisterDeploymentPreparation,
} from '@ledova/shared';
import { registerSteps } from '@pages/company/shared/proposals';
import apiClient from '@services/apiClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { useShareClass } from './useShareClass';

export function deploymentKey(tokenKey: readonly unknown[]) {
  return [...tokenKey, 'deployments'];
}

export function useDeploymentFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const { guard, owner, token } = data;
  const client = useQueryClient();
  const company = token.data?.companyUuid;
  const key = deploymentKey(data.tokenKey);
  const [records, setRecords] = useState<RegisterDeployment[]>([]);
  const original = useRef<{ owner: typeof owner; request: RegisterDeploymentPreparation; company: string } | null>(
    null,
  );
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [workingOwner, setWorkingOwner] = useState<typeof owner>(null);
  const [uncertain, setUncertain] = useState<{ owner: typeof owner; company: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retain = (proposal: RegisterDeployment) =>
    setRecords((rows) => [proposal, ...rows.filter((row) => row.uuid !== proposal.uuid)]);
  const deployments = useQuery({
    queryKey: key,
    enabled: !!owner && !!company && !data.readingPaused,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterDeployments(apiClient, { token: uuid, page }, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (
        rows.some(
          (row) =>
            row.token !== uuid ||
            row.company !== company ||
            row.snapshot.token.uuid !== uuid ||
            row.snapshot.company.uuid !== company,
        )
      )
        throw createUserFriendlyError('The deployments do not identify this company and share class.');
      guard();
      setRecords((retained) => [...rows, ...retained.filter((row) => !rows.some((fresh) => fresh.uuid === row.uuid))]);
      return rows;
    },
  });
  const appointmentKey = owner ? ownAppointmentsKey(owner) : [...COMPANY_QUERY_KEY, 'appointments', null];
  const appointments = useOwnAppointments(owner!, guard, {
    queryKey: appointmentKey,
    enabled: !!owner && !data.readingPaused,
    timing: {},
  });
  const steps =
    appointments.isSuccess && !appointments.isFetching && company ? registerSteps(appointments.data, company) : {};
  const fresh = token.isSuccess && !token.isFetching && token.data.uuid === uuid;
  const recovering = uncertain?.owner === owner && uncertain.company === company;
  const working = busy && workingOwner === owner;
  const canPrepare = fresh && token.data.status === 'draft' && !!steps.prepare && !recovering;
  const guardNewEffect = (kind: 'prepare' | RegisterDecisionKind) => {
    guard();
    const current = client.getQueryState(data.tokenKey);
    const currentToken = client.getQueryData<CompanyShareToken>(data.tokenKey);
    const source = client.getQueryState(appointmentKey);
    const own = client.getQueryData<OwnCompanyAppointment[]>(appointmentKey);
    const expected = steps[kind]?.uuid;
    const listed = client.getQueryState<RegisterDeployment[]>(key);
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      current.isInvalidated ||
      currentToken?.uuid !== uuid ||
      currentToken.companyUuid !== company ||
      source?.status !== 'success' ||
      source.fetchStatus !== 'idle' ||
      source.isInvalidated ||
      !own ||
      !expected ||
      registerSteps(own, company!)[kind]?.uuid !== expected ||
      (kind === 'prepare' && currentToken.status !== 'draft') ||
      (kind !== 'prepare' && (listed?.status !== 'success' || listed.fetchStatus !== 'idle' || listed.isInvalidated))
    )
      throw createUserFriendlyError('Refresh the share class and your appointment before starting this decision.');
  };
  const refresh = async (available?: () => boolean) => {
    const currentRead = () => !available || (available() && !data.readingPaused && !working && !recovering);
    if (!currentRead()) return;
    if (
      available &&
      [key, appointmentKey, data.tokenKey].some((queryKey) => client.isFetching({ queryKey, exact: true }))
    )
      return false;
    guard();
    if ((await appointments.refetch({ cancelRefetch: false })).isError || !currentRead()) return;
    guard();
    if (available) {
      if ((await token.refetch({ cancelRefetch: false })).isError || !currentRead()) return;
    } else await data.refresh();
    guard();
    if (!currentRead()) return;
    await deployments.refetch({ cancelRefetch: false });
    guard();
  };
  const prepare = async () => {
    if (pending.current) return;
    const recovery =
      original.current?.owner === owner && original.current.company === company ? original.current : null;
    let retained = recovery;
    if (!retained) {
      if (!canPrepare || !steps.prepare || !company) return;
      retained = {
        owner,
        request: { operationId: crypto.randomUUID(), appointment: steps.prepare.uuid, token: uuid },
        company,
      };
    }
    pending.current = true;
    setWorkingOwner(owner);
    setBusy(true);
    setError(null);
    try {
      if (!recovery) guardNewEffect('prepare');
      else guard();
      original.current = retained;
      const recovering = !!recovery;
      const response = await prepareRegisterDeployment(apiClient, retained.request, {
        ledovaSubmissionGuard: recovering ? guard : () => guardNewEffect('prepare'),
      });
      guard();
      if (!isPreparedRegisterDeployment(response.data, retained.request, retained.company))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      original.current = null;
      setUncertain(null);
      retain(response.data);
      await refresh();
    } catch (failure) {
      const status = failureStatus(failure);
      if (status === 400 || status === 409) original.current = null;
      setUncertain(original.current ? { owner: original.current.owner, company: original.current.company } : null);
      setError(
        refusalSentence(failure, REGISTER_DEPLOYMENT_UNMET_COPY) ??
          apiErrorSentence(failure, COPY.PREPARE_FAILED, COPY.PREPARATION_RECEIPT_FAILED),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    owner,
    guard,
    client,
    key,
    records,
    busy,
    working,
    uncertain: recovering,
    error,
    retain,
    deployments,
    appointments,
    steps,
    fresh,
    canPrepare,
    guardNewEffect,
    refresh,
    prepare,
  };
}
