import { useOwnAppointments, ownAppointmentsKey } from '@pages/company/shared/useOwnAppointments';
import {
  apiErrorSentence,
  REGISTER_DEPLOYMENT_COPY as COPY,
  createUserFriendlyError,
  failureStatus,
  getRegisterDeployments,
  isPreparedRegisterDeployment,
  prepareRegisterDeployment,
  readEveryPage,
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
  const original = useRef<{ request: RegisterDeploymentPreparation; company: string } | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retain = (proposal: RegisterDeployment) =>
    setRecords((rows) => [proposal, ...rows.filter((row) => row.uuid !== proposal.uuid)]);
  const deployments = useQuery({
    queryKey: key,
    enabled: !!owner && !!company,
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
  const appointments = useOwnAppointments(owner!, guard, { queryKey: appointmentKey, enabled: !!owner, timing: {} });
  const steps =
    appointments.isSuccess && !appointments.isFetching && company ? registerSteps(appointments.data, company) : {};
  const fresh = token.isSuccess && !token.isFetching && token.data.uuid === uuid;
  const canPrepare = fresh && token.data.status === 'draft' && !!steps.prepare && !uncertain;
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
  const refresh = async () => {
    guard();
    await Promise.all([data.refresh(), deployments.refetch(), appointments.refetch()]);
  };
  const prepare = async () => {
    if (pending.current) return;
    let retained = original.current;
    if (!retained) {
      if (!canPrepare || !steps.prepare || !company) return;
      retained = {
        request: { operationId: crypto.randomUUID(), appointment: steps.prepare.uuid, token: uuid },
        company,
      };
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!original.current) guardNewEffect('prepare');
      else guard();
      original.current = retained;
      const recovering = uncertain;
      const response = await prepareRegisterDeployment(apiClient, retained.request, {
        ledovaSubmissionGuard: recovering ? guard : () => guardNewEffect('prepare'),
      });
      guard();
      if (!isPreparedRegisterDeployment(response.data, retained.request, retained.company))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      original.current = null;
      setUncertain(false);
      retain(response.data);
      await refresh();
    } catch (failure) {
      const status = failureStatus(failure);
      if (status === 400 || status === 409) original.current = null;
      setUncertain(!!original.current);
      const codes = (failure as { response?: { data?: { unmetRequirements?: string[] } } }).response?.data
        ?.unmetRequirements;
      setError(
        codes?.length
          ? codes.map((code) => REGISTER_DEPLOYMENT_UNMET_COPY[code] ?? code).join(' ')
          : apiErrorSentence(failure, COPY.PREPARE_FAILED, COPY.PREPARATION_RECEIPT_FAILED),
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
    uncertain,
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
