import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  DESTINATIONS,
  deleteCompanyDocument,
  formatDate,
  getErrorMessage,
  getOperator,
  resubmitApplication,
  submitApplication,
  withdrawApplication,
  type CompanyDocument,
  type DocumentType,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Status, Timeline, type TimelineEvent } from '@components/Ledger';
import { Modal } from '@components/Modal';
import apiClient from '@services/apiClient';
import { useCompany } from '../hooks/useCompany';
import { CompanyReadNotice, CompanyStatusMark } from '../CompanyState';
import { UploadModal } from './UploadModal';
import { OPTIONAL_DOCUMENTS, REQUIRED_DOCUMENTS } from './documents';

const FIELD_CLASS =
  'mt-1 block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary';
const ACTION_ERROR = 'The request was refused. Please try again.';

export default function ListingPage() {
  const data = useCompany();
  const { company } = data;
  const client = useQueryClient();
  const [upload, setUpload] = useState<{ company: string; type: DocumentType; label: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [response, setResponse] = useState('');
  const [responseCompany, setResponseCompany] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const startAction = () => setActionError(null);
  const refuseAction = (error: unknown) => setActionError(getErrorMessage(error, ACTION_ERROR));
  const operator = useQuery({
    queryKey: ['operator'],
    queryFn: () => getOperator(apiClient),
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
  const operatorName = operator.isError ? 'The operator' : operator.data?.data.name || 'The operator';
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['company'] }),
      client.invalidateQueries({ queryKey: ['companies'] }),
    ]);
  const submit = useMutation({
    mutationFn: (uuid: string) => submitApplication(apiClient, uuid),
    onSuccess: refresh,
    onMutate: startAction,
    onError: refuseAction,
  });
  const resubmit = useMutation({
    onMutate: startAction,
    onError: refuseAction,
    mutationFn: ({ uuid, text }: { uuid: string; text: string }) =>
      resubmitApplication(apiClient, uuid, { response: text }),
    onSuccess: async () => {
      await refresh();
      setResponse('');
      setResponseCompany(null);
    },
  });
  const withdraw = useMutation({
    mutationFn: ({ uuid, reason }: { uuid: string; reason: string }) =>
      withdrawApplication(apiClient, uuid, { reason }),
    onSuccess: async () => {
      await refresh();
      setWithdrawing(null);
      setWithdrawReason('');
    },
  });
  const remove = useMutation({
    onMutate: startAction,
    onError: refuseAction,
    mutationFn: ({ uuid, document }: { uuid: string; document: string }) =>
      deleteCompanyDocument(apiClient, uuid, document),
    onSuccess: refresh,
  });
  const busy = submit.isPending || resubmit.isPending || withdraw.isPending || remove.isPending;
  const ready = !!company && !data.error && !data.isRefreshing;
  const editable = company?.status === 'draft' || company?.status === 'info_required';
  const canWithdraw = company?.status === 'submitted' || company?.status === 'info_required';
  const documents = company?.documents ?? [];
  const missing = REQUIRED_DOCUMENTS.filter(
    (required) => !documents.some((document) => document.documentType === required.type),
  );
  const canSubmit = ready && company.status === 'draft' && missing.length === 0 && !busy;
  const canResubmit =
    ready &&
    company.status === 'info_required' &&
    missing.length === 0 &&
    responseCompany === company.uuid &&
    response.trim() !== '' &&
    !busy;
  const events: TimelineEvent[] = company
    ? [
        ['Submitted', company.submittedAt],
        ['Review started', company.reviewStartedAt],
        ['Information requested', company.infoRequestedAt],
        ['Approved', company.approvedAt],
        ['Activated', company.activatedAt],
        ['Rejected', company.rejectionAt],
        ['Withdrawn', company.withdrawnAt],
      ]
        .flatMap(([label, at]) => (at ? [{ label: label!, at }] : []))
        .sort((a, b) => a.at.localeCompare(b.at))
    : [];
  const showDocuments = (title: string, types: { type: DocumentType; label: string }[], required: boolean) => (
    <Section title={title}>
      <ul className="divide-y divide-border-subtle">
        {types.map(({ type, label }) => {
          const matches = documents.filter((document) => document.documentType === type);
          return (
            <li key={type} className="space-y-3 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-text-primary">{label}</h3>
                <Status tone={matches.length ? 'done' : 'waiting'}>
                  {matches.length ? 'Uploaded' : required ? 'Required' : 'Optional'}
                </Status>
              </div>
              {matches.map((document: CompanyDocument) => (
                <div key={document.uuid} className="space-y-2 text-sm">
                  <p className="break-all text-text-primary">{document.name}</p>
                  <p className="text-text-muted">
                    Uploaded {formatDate(document.createdAt)} · {document.isVerified ? 'Verified' : 'Not verified'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 break-all">
                    {document.fileUrl && (
                      <a
                        href={document.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-brand-light underline"
                      >
                        View {document.name}
                      </a>
                    )}
                    {editable && (
                      <PageAction
                        label={`Remove ${document.name}`}
                        onClick={() => {
                          if (ready && editable && !busy)
                            remove.mutate({ uuid: company!.uuid, document: document.uuid });
                        }}
                        disabled={!ready || busy}
                      />
                    )}
                  </div>
                </div>
              ))}
              {editable && matches.length === 0 && type !== 'other' && (
                <PageAction
                  label={`Upload ${label}`}
                  onClick={() => setUpload({ company: company!.uuid, type, label })}
                  disabled={!ready || busy}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
  return (
    <>
      <Page loading={data.isLoading}>
        <Link to={DESTINATIONS.company.path} className="w-fit text-sm text-brand-light underline">
          Back to Company
        </Link>
        {data.error ? (
          <CompanyReadNotice read={data} />
        ) : !company ? (
          <p className="text-sm text-text-muted">No company found. Please register your company first.</p>
        ) : (
          <>
            <Section title="Application record">
              <p className="break-words text-sm text-text-primary">{company.name}</p>
              <Rows>
                <Row label="Status">
                  <CompanyStatusMark status={company.status} label={company.statusDisplay} />
                </Row>
              </Rows>
              {events.length > 0 && <Timeline events={events} />}
              {company.status === 'submitted' && (
                <p className="text-sm text-text-muted">
                  Your application is waiting for {operatorName} to start the review.
                </p>
              )}
              {company.status === 'review' && (
                <p className="text-sm text-text-muted">
                  {operatorName} is reviewing your application. Withdrawal is no longer available once review has
                  started.
                </p>
              )}
              {company.rejectionReason && (
                <p className="whitespace-pre-wrap text-sm text-text-muted">
                  Rejection reason: {company.rejectionReason}
                </p>
              )}
              {company.withdrawalReason && (
                <p className="whitespace-pre-wrap text-sm text-text-muted">
                  Withdrawal reason: {company.withdrawalReason}
                </p>
              )}
              {company.infoRequestReason && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-text-primary">Information requested</p>
                  <p className="whitespace-pre-wrap text-text-muted">{company.infoRequestReason}</p>
                </div>
              )}
              {company.additionalInfoResponse && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-text-primary">Your previous response</p>
                  <p className="whitespace-pre-wrap text-text-muted">{company.additionalInfoResponse}</p>
                </div>
              )}
              {canWithdraw && (
                <PageAction
                  label="Withdraw application"
                  onClick={() => {
                    withdraw.reset();
                    setWithdrawing(company.uuid);
                    setWithdrawReason('');
                  }}
                  disabled={!ready || busy}
                />
              )}
            </Section>
            {actionError && (
              <p role="alert" className="text-sm text-error-light">
                {actionError}
              </p>
            )}
            {showDocuments('Required documents', REQUIRED_DOCUMENTS, true)}
            {showDocuments('Optional documents', OPTIONAL_DOCUMENTS, false)}
            {company.status === 'info_required' && (
              <Section title="Your response">
                <p className="text-sm text-text-muted">
                  Answer the request, upload the documents it asks for, then resubmit your application.
                </p>
                <label className="block text-sm">
                  Response to the operator
                  <textarea
                    className={FIELD_CLASS}
                    rows={4}
                    value={response}
                    onChange={(event) => {
                      setResponseCompany(company.uuid);
                      setResponse(event.target.value);
                    }}
                    disabled={busy}
                  />
                </label>
                {responseCompany && responseCompany !== company.uuid && (
                  <p role="alert" className="text-sm text-error-light">
                    This response belongs to another company. Edit it before continuing.
                  </p>
                )}
                <PageAction
                  label={resubmit.isPending ? 'Resubmitting…' : 'Resubmit application'}
                  onClick={() => {
                    if (canResubmit) resubmit.mutate({ uuid: company.uuid, text: response.trim() });
                  }}
                  disabled={!canResubmit}
                />
              </Section>
            )}
            {company.status === 'draft' && (
              <PageAction
                label={submit.isPending ? 'Submitting…' : 'Submit application'}
                onClick={() => {
                  if (canSubmit) submit.mutate(company.uuid);
                }}
                disabled={!canSubmit}
              />
            )}
            {editable && missing.length > 0 && (
              <p className="text-sm text-text-muted">
                {missing.length} required document{missing.length === 1 ? '' : 's'} still missing.
              </p>
            )}
            <Section title="What happens next">
              <p className="text-sm text-text-muted">
                {operatorName} reviews the application and may request more information. Approval and activation are
                separate decisions. Share classes can be deployed once the company is active.
              </p>
              {operator.isError && (
                <div role="alert" className="space-y-2 text-sm text-text-muted">
                  <p>Operator details could not be loaded.</p>
                  <PageAction
                    label="Retry operator details"
                    onClick={() => void operator.refetch()}
                    disabled={operator.isFetching}
                  />
                </div>
              )}
            </Section>
          </>
        )}
      </Page>
      {withdrawing && (
        <Modal
          isOpen
          title="Withdraw application"
          showFooter
          confirmLabel="Withdraw application"
          confirmLoading={withdraw.isPending}
          confirmDisabled={!ready || !canWithdraw || company?.uuid !== withdrawing || busy}
          onConfirm={() => {
            if (ready && canWithdraw && company.uuid === withdrawing && !busy)
              withdraw.mutate({ uuid: withdrawing, reason: withdrawReason.trim() });
          }}
          onClose={() => {
            if (!withdraw.isPending) setWithdrawing(null);
          }}
        >
          <fieldset disabled={withdraw.isPending} className="space-y-4">
            <CompanyReadNotice read={data} />
            {!canWithdraw && !data.error && !data.isRefreshing && (
              <p role="alert" className="text-sm text-text-muted">
                This application can no longer be withdrawn.
              </p>
            )}
            {withdraw.isError && (
              <p role="alert" className="text-sm text-error-light">
                {getErrorMessage(withdraw.error, ACTION_ERROR)}
              </p>
            )}
            <p className="text-sm text-text-muted">
              Withdrawal takes the application out of the review queue. You will need to register again to apply later.
            </p>
            <label className="block text-sm">
              Reason (optional)
              <textarea
                className={FIELD_CLASS}
                rows={3}
                value={withdrawReason}
                onChange={(event) => setWithdrawReason(event.target.value)}
              />
            </label>
          </fieldset>
        </Modal>
      )}
      {upload && (
        <UploadModal
          companyUuid={upload.company}
          documentType={upload.type}
          label={upload.label}
          canUpload={!!company && company.uuid === upload.company && editable}
          read={data}
          onClose={() => setUpload(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}
