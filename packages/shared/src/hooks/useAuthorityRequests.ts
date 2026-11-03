import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompanies } from '../services/companies';
import {
  admitCompanyAuthorityRequest,
  downloadCompanyAuthorityFile,
  getCompanyAuthorityRequests,
  revokeCompanyAuthorityAppointment,
  withdrawCompanyAuthorityRequest,
} from '../services/company-authority';
import type { CompanyAuthorityRequest } from '../types';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { ownCompaniesKey } from './useCompanySelection';
import { ownAppointmentsKey } from './useOwnAppointments';
import { ownershipCompaniesKey } from './useOwnershipCompanies';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function authorityRequestsKey(owner: OrderSubmissionOwner) {
  return ['company-authority-requests', owner.userUuid, owner.ownerAccountUuid];
}

export function authorityRequestStatus(request: CompanyAuthorityRequest) {
  if (request.status === 'withdrawn') return 'Withdrawn';
  if (request.status === 'pending') return 'Pending';
  if (request.appointment?.status === 'revoked') return 'Appointment revoked';
  return request.appointment?.status === 'expired' ? 'Appointment expired' : 'Admitted';
}

export function useAuthorityRequests({
  owner,
  currentOwner,
  company: chosen,
  readCompanies = true,
  session,
  save,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company?: string | null;
  readCompanies?: boolean;
  session?: OrderSubmissionSession;
  save?: (data: ArrayBuffer, request: CompanyAuthorityRequest) => unknown;
}) {
  const apiClient = useApiClient();
  const guard = useCallback(() => {
    if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen representative authority.');
  }, [owner, currentOwner]);
  const [recorded, setRecorded] = useState<CompanyAuthorityRequest | null>(null);
  const client = useQueryClient();
  const historyKey = authorityRequestsKey(owner);
  const companies = useQuery({
    queryKey: [...ownCompaniesKey(owner), 'authority'],
    enabled: readCompanies,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanies(apiClient, page, {
          ...session?.requestConfig(),
          ledovaSubmissionGuard: guard,
        });
        guard();
        return result;
      }),
  });
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanyAuthorityRequests(apiClient, undefined, page, {
          ...session?.requestConfig(),
          ledovaSubmissionGuard: guard,
        });
        guard();
        return result;
      }),
  });
  const drafts = companies.isError ? [] : (companies.data ?? []).filter((company) => company.status === 'draft');
  const selected = chosen ?? (drafts.length === 1 ? drafts[0]!.uuid : '');
  const company = drafts.find((item) => item.uuid === selected);
  const lifecycle = useMutation({
    mutationFn: async ({
      request,
      action,
    }: {
      request: CompanyAuthorityRequest;
      action: 'withdraw' | 'admit' | 'revoke';
    }) => {
      guard();
      const send =
        action === 'admit'
          ? admitCompanyAuthorityRequest
          : action === 'revoke'
            ? revokeCompanyAuthorityAppointment
            : withdrawCompanyAuthorityRequest;
      const { data } = await send(apiClient, request.uuid, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (
        data.uuid !== request.uuid ||
        (action === 'withdraw' && (data.status !== 'withdrawn' || !data.withdrawnAt)) ||
        (action === 'admit' && (data.status !== 'admitted' || !data.appointment)) ||
        (action === 'revoke' &&
          (data.status !== 'admitted' || data.appointment?.status !== 'revoked' || !data.appointment.revokedAt))
      )
        throw new Error('The request outcome could not be confirmed. Refresh your requests or retry.');
      return data;
    },
    onSuccess: async (request, { action }) => {
      guard();
      const refused = client.getQueryState(historyKey)?.status === 'error';
      await client.cancelQueries({ queryKey: historyKey, exact: true });
      guard();
      if (!refused && client.getQueryState(historyKey)?.status !== 'error')
        client.setQueryData<CompanyAuthorityRequest[]>(historyKey, (previous) =>
          previous?.map((item) => (item.uuid === request.uuid ? request : item)),
        );
      if (action !== 'withdraw') {
        void client.invalidateQueries({ queryKey: ownAppointmentsKey(owner) });
        void client.invalidateQueries({ queryKey: ownershipCompaniesKey(owner) });
      }
    },
  });
  const opening = useMutation({
    mutationFn: async (request: CompanyAuthorityRequest) => {
      guard();
      const { data } = await downloadCompanyAuthorityFile(apiClient, request.uuid, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      await save?.(data, request);
    },
  });
  return {
    guard,
    recorded,
    setRecorded,
    companies,
    history,
    company,
    lifecycle,
    opening,
  };
}
