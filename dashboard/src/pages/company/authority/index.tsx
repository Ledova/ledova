import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  admitCompanyAuthorityRequest,
  downloadCompanyAuthorityFile,
  getCompanies,
  getCompanyAuthorityRequests,
  getErrorMessage,
  readEveryPage,
  revokeCompanyAuthorityAppointment,
  useSubmissionOwner,
  useUserPreferences,
  withdrawCompanyAuthorityRequest,
  type CompanyAuthorityRequest,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Section } from '@components/Ledger';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { AuthorityRequestForm } from './AuthorityRequestForm';
import { AuthorityRequestRecord } from './AuthorityRequestRecord';

export default function CompanyAuthorityPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (!owner)
    return (
      <Page>
        <p className="text-sm text-text-muted">
          Verify your signed-in account before opening representative authority.
        </p>
        {preferences.isError && <PageAction label="Retry your account" onClick={() => void preferences.refetch()} />}
      </Page>
    );
  return (
    <OwnAuthorityRequests
      key={`${owner.userUuid}/${owner.ownerAccountUuid}`}
      owner={owner}
      currentOwner={boundary.get}
    />
  );
}

function OwnAuthorityRequests({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useCallback(() => {
    if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen representative authority.');
  }, [owner, currentOwner]);
  const [selected, setSelected] = useState('');
  const [recorded, setRecorded] = useState<CompanyAuthorityRequest | null>(null);
  const client = useQueryClient();
  const historyKey = ['company-authority-requests', owner.userUuid, owner.ownerAccountUuid];
  const companies = useQuery({
    queryKey: ['companies', 'authority', owner.userUuid, owner.ownerAccountUuid],
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
      const copy = URL.createObjectURL(new Blob([data], { type: request.mimeType }));
      const link = document.createElement('a');
      link.href = copy;
      link.download = request.originalFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(copy), 60000);
    },
  });
  return (
    <Page>
      <p className="text-sm text-text-muted">
        Establish your representative appointment by accepting an authorisation declaration for your company. Company
        information is provided by the company. Submitting evidence alone grants no authority.
      </p>
      <Section title="New authority request">
        {companies.isLoading ? (
          <p role="status" className="text-sm text-text-muted">
            Loading your companies…
          </p>
        ) : companies.isError ? (
          <div role="alert" className="space-y-2 text-sm text-error-light">
            <p>Your companies could not be loaded.</p>
            <PageAction
              label="Retry companies"
              onClick={() => void companies.refetch()}
              disabled={companies.isFetching}
            />
          </div>
        ) : drafts.length === 0 ? (
          <p className="text-sm text-text-muted">No draft company is available for an authority request.</p>
        ) : (
          <label className="block space-y-1 text-sm text-text-primary">
            Draft company
            <select
              value={selected}
              disabled={companies.isFetching}
              onChange={(event) => {
                setSelected(event.target.value);
                setRecorded(null);
              }}
              className={FIELD_CLASS}
            >
              <option value="">Select your draft company</option>
              {drafts.map((item) => (
                <option key={item.uuid} value={item.uuid}>
                  {item.name} · {item.acn}
                </option>
              ))}
            </select>
          </label>
        )}
        {recorded ? (
          <div role="status" className="space-y-2 text-sm text-text-primary">
            <p>
              Request recorded: {recorded.uuid}. {recorded.verificationMessage}
            </p>
            <PageAction label="Start another request" onClick={() => setRecorded(null)} />
          </div>
        ) : (
          company && (
            <AuthorityRequestForm
              key={company.uuid}
              company={company}
              disabled={companies.isFetching}
              guard={guard}
              onSuccess={(request) => {
                guard();
                setRecorded(request);
                void history.refetch();
              }}
            />
          )
        )}
      </Section>
      <Section title="Your request history">
        {history.isLoading ? (
          <p role="status" className="text-sm text-text-muted">
            Loading your requests…
          </p>
        ) : history.isError ? (
          <div role="alert" className="space-y-2 text-sm text-error-light">
            <p>Your authority requests could not be loaded.</p>
            <PageAction
              label="Retry request history"
              onClick={() => void history.refetch()}
              disabled={history.isFetching}
            />
          </div>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No authority requests recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(history.data ?? []).map((request) => (
              <AuthorityRequestRecord
                key={request.uuid}
                request={request}
                blocked={lifecycle.isPending || history.isFetching}
                opening={opening.isPending}
                action={
                  lifecycle.isPending && lifecycle.variables?.request.uuid === request.uuid
                    ? lifecycle.variables.action
                    : undefined
                }
                onDownload={() => opening.mutate(request)}
                onWithdraw={() => lifecycle.mutate({ request, action: 'withdraw' })}
                onAdmit={() => lifecycle.mutate({ request, action: 'admit' })}
                onRevoke={() => lifecycle.mutate({ request, action: 'revoke' })}
              />
            ))}
          </ul>
        )}
        {opening.isError && (
          <p role="alert" className="text-sm text-error-light">
            {getErrorMessage(opening.error, 'Your evidence could not be downloaded.')}
          </p>
        )}
        {lifecycle.isError && (
          <p role="alert" className="text-sm text-error-light">
            {getErrorMessage(lifecycle.error, 'Your request outcome could not be confirmed. Refresh or retry.')}
          </p>
        )}
      </Section>
    </Page>
  );
}
