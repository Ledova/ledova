import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  DESTINATIONS,
  REQUIRED_DOCUMENTS,
  getErrorMessage,
  createUserFriendlyError,
  getOperator,
  resubmitApplication,
  submitApplication,
  withdrawApplication,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section, Timeline, type TimelineEvent } from '@components/Ledger';
import { Modal } from '@components/Modal';
import apiClient from '@services/apiClient';
import { useCompany } from '../hooks/useCompany';
import { CompanyReadNotice, CompanyStatusMark } from '../CompanyState';
import { CompanyDocuments } from '../CompanyDocuments';
import { CompanySelection } from '../CompanySelection';
import { FIELD_CLASS } from '@components/fieldClass';

const ACTION_ERROR = 'The request was refused. Please try again.';

export default function ListingPage() {
  const data = useCompany({ ownedOnly: true });
  return <CompanyApplication key={`${data.scopeKey}/${data.companyUuid ?? ''}`} data={data} />;
}

function CompanyApplication({ data }: { data: ReturnType<typeof useCompany> }) {
  const navigate = useNavigate();
  const { company } = data;
  const client = useQueryClient();
  const [withdrawing, setWithdrawing] = useState<{ uuid: string; identity: symbol } | null>(null);
  const confirmation = useRef<typeof withdrawing>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      confirmation.current = null;
    };
  }, []);
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
      client.invalidateQueries({ queryKey: data.companyKey }),
      client.invalidateQueries({ queryKey: data.companiesKey }),
    ]);
  const action = (uuid: string) => {
    const assertCurrent = data.assertCurrent;
    const companyKey = data.companyKey;
    const companiesKey = data.companiesKey;
    const guard = () => {
      if (!mounted.current) throw createUserFriendlyError('This company action is closed.');
      assertCurrent(uuid, 'owner');
    };
    guard();
    return {
      uuid,
      guard,
      config: { ...data.requestConfig(uuid, 'owner'), ledovaSubmissionGuard: guard },
      refresh: async () => {
        guard();
        await Promise.all([
          client.invalidateQueries({ queryKey: companyKey }),
          client.invalidateQueries({ queryKey: companiesKey }),
        ]);
        guard();
      },
    };
  };
  type Action = ReturnType<typeof action>;
  const settle = () => {
    pending.current = false;
  };
  const submit = useMutation({
    mutationFn: async ({ uuid, guard, config }: Action) => {
      guard();
      const result = await submitApplication(apiClient, uuid, config);
      guard();
      return result;
    },
    onSuccess: (_, value) => value.refresh(),
    onMutate: startAction,
    onError: refuseAction,
    onSettled: settle,
  });
  const resubmit = useMutation({
    onMutate: startAction,
    onError: refuseAction,
    onSettled: settle,
    mutationFn: async ({ uuid, text, guard, config }: Action & { text: string }) => {
      guard();
      const result = await resubmitApplication(apiClient, uuid, { response: text }, config);
      guard();
      return result;
    },
    onSuccess: async (_, value) => {
      await value.refresh();
      setResponse('');
      setResponseCompany(null);
    },
  });
  const withdraw = useMutation({
    mutationFn: async ({ uuid, reason, guard, config }: Action & { reason: string }) => {
      guard();
      const result = await withdrawApplication(apiClient, uuid, { reason }, config);
      guard();
      return result;
    },
    onSuccess: async (_, value) => {
      await value.refresh();
      confirmation.current = null;
      setWithdrawing(null);
      setWithdrawReason('');
    },
    onSettled: settle,
  });
  const busy = submit.isPending || resubmit.isPending || withdraw.isPending;
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
  return (
    <>
      <Page
        loading={data.isLoading}
        actions={<PageAction label="Back to Company" onClick={() => navigate(DESTINATIONS.company.path)} />}
      >
        <CompanySelection read={data} />
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
                    const value = { uuid: company.uuid, identity: Symbol() };
                    confirmation.current = value;
                    setWithdrawing(value);
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
                    if (canResubmit && !pending.current) {
                      try {
                        const value = action(company.uuid);
                        pending.current = true;
                        resubmit.mutate({ ...value, text: response.trim() });
                      } catch (error) {
                        refuseAction(error);
                      }
                    }
                  }}
                  disabled={!canResubmit}
                />
              </Section>
            )}
            {company.status === 'draft' && (
              <PageAction
                label={submit.isPending ? 'Submitting…' : 'Submit application'}
                onClick={() => {
                  if (canSubmit && !pending.current) {
                    try {
                      const value = action(company.uuid);
                      pending.current = true;
                      submit.mutate(value);
                    } catch (error) {
                      refuseAction(error);
                    }
                  }
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
        {data.retainedCompany && (
          <CompanyDocuments
            key={`${data.scopeKey}/${data.retainedCompany.uuid}`}
            company={data.retainedCompany}
            read={data}
            editable={editable && data.canAdmin && !busy}
            refresh={refresh}
            onAction={startAction}
          />
        )}
      </Page>
      {withdrawing && (
        <Modal
          isOpen
          title="Withdraw application"
          showFooter
          confirmLabel="Withdraw application"
          confirmLoading={withdraw.isPending}
          confirmDisabled={!ready || !canWithdraw || company?.uuid !== withdrawing.uuid || busy}
          onConfirm={() => {
            if (
              ready &&
              canWithdraw &&
              company.uuid === withdrawing.uuid &&
              !busy &&
              !pending.current &&
              confirmation.current === withdrawing
            ) {
              try {
                const value = action(withdrawing.uuid);
                confirmation.current = null;
                pending.current = true;
                withdraw.mutate(
                  { ...value, reason: withdrawReason.trim() },
                  {
                    onError: () => {
                      try {
                        value.guard();
                        const next = { uuid: value.uuid, identity: Symbol() };
                        confirmation.current = next;
                        setWithdrawing(next);
                      } catch {}
                    },
                  },
                );
              } catch (error) {
                refuseAction(error);
              }
            }
          }}
          onClose={() => {
            if (!withdraw.isPending) {
              confirmation.current = null;
              setWithdrawing(null);
            }
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
    </>
  );
}
