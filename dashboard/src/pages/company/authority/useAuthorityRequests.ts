import {
  admitCompanyAuthorityRequest,
  downloadCompanyAuthorityFile,
  getCompanies,
  getCompanyAuthorityRequests,
  readEveryPage,
  revokeCompanyAuthorityAppointment,
  withdrawCompanyAuthorityRequest,
  type CompanyAuthorityRequest,
  type OrderSubmissionOwner,
  COMPANIES_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useLocation } from 'react-router-dom';

export function authorityRequestsKey(owner: OrderSubmissionOwner) {
  return ['company-authority-requests', owner.userUuid, owner.ownerAccountUuid];
}

export function authorityCompaniesKey(owner: OrderSubmissionOwner) {
  return [...COMPANIES_QUERY_KEY, 'authority', owner.userUuid, owner.ownerAccountUuid];
}

export function useAuthorityRequests({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useCallback(() => {
    if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen representative authority.');
  }, [owner, currentOwner]);
  const context = useCompanyContext();
  const location = useLocation();
  const [recorded, setRecorded] = useState<CompanyAuthorityRequest | null>(null);
  const client = useQueryClient();
  const historyKey = authorityRequestsKey(owner);
  const companies = useQuery({
    queryKey: authorityCompaniesKey(owner),
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanies(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
  });
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanyAuthorityRequests(apiClient, undefined, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
  });
  const drafts = companies.isError ? [] : (companies.data ?? []).filter((company) => company.status === 'draft');
  const selected = context
    ? (context.companyUuid ?? '')
    : (new URLSearchParams(location.search).get('company') ?? (drafts.length === 1 ? drafts[0].uuid : ''));
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
      const { data } = await send(apiClient, request.uuid, { ledovaSubmissionGuard: guard });
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
    onSuccess: async (request) => {
      guard();
      const refused = client.getQueryState(historyKey)?.status === 'error';
      await client.cancelQueries({ queryKey: historyKey, exact: true });
      guard();
      if (!refused && client.getQueryState(historyKey)?.status !== 'error')
        client.setQueryData<CompanyAuthorityRequest[]>(historyKey, (previous) =>
          previous?.map((item) => (item.uuid === request.uuid ? request : item)),
        );
      setRecorded((previous) => (previous?.uuid === request.uuid ? request : previous));
    },
  });
  const opening = useMutation({
    mutationFn: async (request: CompanyAuthorityRequest) => {
      guard();
      const { data } = await downloadCompanyAuthorityFile(apiClient, request.uuid, { ledovaSubmissionGuard: guard });
      guard();
      saveFile(new Blob([data], { type: request.mimeType }), request.originalFilename);
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
