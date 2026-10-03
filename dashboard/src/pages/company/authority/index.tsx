import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  downloadCompanyAuthorityFile,
  formatDateTime,
  getCompanies,
  getCompanyAuthorityRequests,
  getErrorMessage,
  readEveryPage,
  useSubmissionOwner,
  useUserPreferences,
  withdrawCompanyAuthorityRequest,
  type CompanyAuthorityRequest,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Status } from '@components/Ledger';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { AuthorityRequestForm } from './AuthorityRequestForm';

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
  const withdrawal = useMutation({
    mutationFn: async (request: CompanyAuthorityRequest) => {
      guard();
      const { data } = await withdrawCompanyAuthorityRequest(apiClient, request.uuid, { ledovaSubmissionGuard: guard });
      guard();
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
        Representative authority verification is unavailable. Submitting evidence grants no company authority.
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
              <li key={request.uuid} className="space-y-2 py-3">
                <Rows>
                  <Row label="Request">{request.uuid}</Row>
                  <Row label="Company">
                    {request.companyIdentityRaw.name} · {request.companyIdentityRaw.acn}
                  </Row>
                  <Row label="Status">
                    <Status tone={request.status === 'withdrawn' ? 'closed' : 'waiting'}>
                      {request.status === 'withdrawn' ? 'Withdrawn' : 'Pending verification'}
                    </Status>
                  </Row>
                  <Row label="Submitted">{formatDateTime(request.createdAt)}</Row>
                  {request.withdrawnAt && <Row label="Withdrawn">{formatDateTime(request.withdrawnAt)}</Row>}
                  <Row label="Requested expiry">
                    {request.requestedExpiresAt ? formatDateTime(request.requestedExpiresAt) : 'No requested expiry'}
                  </Row>
                  <Row label="Requested actions">
                    {request.requestedCapabilities
                      .map(
                        (value) => COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value,
                      )
                      .join(', ') || 'None'}
                  </Row>
                  <Row label="Requested delegation">
                    {request.delegatableCapabilities
                      .map(
                        (value) => COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value,
                      )
                      .join(', ') || 'None'}
                  </Row>
                </Rows>
                <p className="text-sm text-text-muted">{request.verificationMessage}</p>
                <PageAction
                  label={`Download evidence ${request.originalFilename}`}
                  disabled={opening.isPending || history.isFetching}
                  onClick={() => opening.mutate(request)}
                />
                {request.status === 'pending' && (
                  <>
                    <p className="text-sm text-text-muted">
                      Withdrawing retires this request and retains its evidence.
                    </p>
                    <PageAction
                      label={`${withdrawal.isPending && withdrawal.variables?.uuid === request.uuid ? 'Withdrawing' : 'Withdraw'} request ${request.originalFilename}`}
                      disabled={withdrawal.isPending || history.isFetching}
                      onClick={() => withdrawal.mutate(request)}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {opening.isError && (
          <p role="alert" className="text-sm text-error-light">
            {getErrorMessage(opening.error, 'Your evidence could not be downloaded.')}
          </p>
        )}
        {withdrawal.isError && (
          <p role="alert" className="text-sm text-error-light">
            {getErrorMessage(withdrawal.error, 'Your request could not be withdrawn. Retry to check its outcome.')}
          </p>
        )}
      </Section>
    </Page>
  );
}
