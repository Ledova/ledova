import { SelectField } from '@components/SelectField';
import { Choices } from '@components/Choices';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAutomaticReads } from '@hooks/useAutomaticReads';
import { useRunningAction } from '@hooks/useRunningAction';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  FIELD_LIMITS,
  DESTINATIONS,
  ELIGIBILITY_RECORDS_NOTICE,
  isCurrentEligibilityAppointment,
  useCompanyEligibilityRecords,
  formatDate,
  shortReference,
} from '@ledova/shared';
import { LinkRow, Section, LoadError } from '@components/Ledger';
import { Pager } from '@components/List';
import { PAGE_SIZE, useFirstPageWhenGone, useListParams } from '@hooks/useListParams';
import { FormActions, Page, PageAction } from '@components/Page';
import { ActionConfirmation, EligibilityHistory, RecordsList } from '@components/eligibility';
import { Field, TextInput } from '@components/Field';
import { CompanyWalletInstructions } from './CompanyWalletInstructions';
import { scopeLabels } from '@pages/company/shared/appointments';

const OUTCOMES = [
  ['accepted', 'Accept'],
  ['refused', 'Refuse'],
] as const;
const QUEUE_OUTCOMES = [
  ['', 'All'],
  ['pending', 'Pending'],
  ['accepted', 'Accepted'],
  ['refused', 'Refused'],
  ['withdrawn', 'Withdrawn'],
  ['revoked', 'Revoked'],
  ['expired', 'Expired'],
] as const;

type QueueOutcome = Exclude<(typeof QUEUE_OUTCOMES)[number][0], ''>;

export default function CompanyEligibilityPage() {
  const context = useCompanyContext();
  const requestedCompany = new URLSearchParams(useLocation().search).get('company');
  const [actionOpener, setActionOpener] = useState<HTMLElement | null>(null);
  const list = useListParams(['outcome']);
  const outcome = QUEUE_OUTCOMES.find(([value]) => value && value === list.filters.outcome)?.[0] as
    QueueOutcome | undefined;
  const read = useCompanyEligibilityRecords(
    () => crypto.randomUUID(),
    undefined,
    {
      page: list.page,
      pageSize: PAGE_SIZE,
      outcome,
    },
    { coordinatedReads: true, selectedCompany: context ? (context.companyUuid ?? '') : (requestedCompany ?? '') },
  );
  useAutomaticReads({ scope: read.owner ? read.scopeKey : null, paused: read.readingPaused, refresh: read.refresh });
  const gone = useFirstPageWhenGone(list, read.listError);
  const queue = read.queue;
  const [revocationReason, setRevocationReason] = useState('');
  const { running, track } = useRunningAction();
  const accepting = read.draft.outcome === 'accepted';
  const decisionChecks = useErrorSummary({
    expiresAt:
      accepting && !Number.isFinite(Date.parse(read.draft.expiresAt)) && 'Enter the acceptance expiry date and time.',
    reason: !accepting && !read.draft.reason.trim() && 'Give the refusal reason.',
  });
  const revocationChecks = useErrorSummary({
    reason: !revocationReason.trim() && 'Give the revocation reason.',
  });
  const forget = () => {
    setRevocationReason('');
    decisionChecks.reset();
    revocationChecks.reset();
  };
  const appointment = read.appointments.find(
    (item) => item.uuid === read.appointmentUuid && item.company === read.companyUuid,
  );
  const canApprove =
    !!appointment && isCurrentEligibilityAppointment(appointment) && appointment.capabilities.includes('approve');
  return (
    <Page loading={read.loading} lede={ELIGIBILITY_RECORDS_NOTICE}>
      {!read.owner ? (
        <p>Your signed-in account must be checked before opening these records.</p>
      ) : (
        <>
          {read.readFailed && !gone && (
            <LoadError retry={() => read.refresh()} busy={read.refreshing || read.busy}>
              The company&apos;s eligibility records could not be loaded.
            </LoadError>
          )}
          {(read.readFailed ? read.failure : read.error) && !gone && (
            <p role="alert" className="text-sm text-error-light">
              {read.readFailed ? read.failure : read.error}
            </p>
          )}
          <div hidden={!!read.action} className="flex flex-col gap-5">
            <Section title="Your personal company authority">
              <LinkRow
                to={context?.companyPath(DESTINATIONS.companyTeam.path) ?? DESTINATIONS.companyTeam.path}
                label={DESTINATIONS.companyTeam.title}
              />
              <p className="text-sm text-text-muted">
                Current personal prepare or approve authority permits reading this company&apos;s queue and preparing a
                decision. Recording a decision or revocation requires your own approve appointment.
              </p>
              {!read.companyUuid && <CompanyContextNotice />}
              {read.companyUuid && (
                <p className="text-sm text-text-muted">
                  {read.companies.find((company) => company.uuid === read.companyUuid)?.name ??
                    (context?.companyUuid === read.companyUuid ? context.company?.name : 'Original company')}
                </p>
              )}
              {!read.readFailed && read.companies.length === 0 && (
                <p>No current personal prepare or approve appointments are available.</p>
              )}
              {read.companyUuid && (
                <SelectField
                  label="Your exact decision appointment"
                  options={[
                    { value: '', label: 'Select your appointment' },
                    ...read.appointments
                      .filter(
                        (item) =>
                          item.company === read.companyUuid &&
                          item.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'),
                      )
                      .map((item) => ({
                        value: item.uuid,
                        label: `${scopeLabels(item.capabilities)} · appointed ${formatDate(item.createdAt)}${
                          isCurrentEligibilityAppointment(item) ? '' : ' · inactive'
                        }`,
                        reference: shortReference(item.uuid),
                      })),
                  ]}
                  value={read.appointmentUuid}
                  onChange={read.setAppointment}
                />
              )}
            </Section>
            {read.companyUuid && (
              <Section title="Company request queue">
                <Choices
                  legend="Outcome"
                  options={QUEUE_OUTCOMES}
                  value={outcome ?? ''}
                  onChange={(value) => list.setFilter('outcome', value)}
                />
                {queue?.settled && queue.rows.length === 0 ? (
                  <p role="status" className="text-sm text-text-muted">
                    {outcome ? 'No requests match.' : 'No requests yet.'}
                  </p>
                ) : queue?.rows.length ? (
                  <div aria-busy={queue.busy} className={queue.busy ? 'opacity-60' : undefined}>
                    <RecordsList
                      records={queue.rows}
                      disabled={queue.busy}
                      select={(uuid) => {
                        read.selectRecord(uuid);
                        forget();
                      }}
                      selected={read.selectedRecord?.uuid}
                    />
                  </div>
                ) : null}
                <Pager
                  label="Request pages"
                  list={list}
                  noun={['request', 'requests']}
                  count={queue?.count ?? 0}
                  busy={queue?.busy}
                />
              </Section>
            )}
            {read.selectedRecord && (
              <>
                <EligibilityHistory record={read.selectedRecord} />
                {read.selectedRecord.outcome === 'pending' && (
                  <Section title="Prepare the exact company decision">
                    <ErrorSummary {...decisionChecks.summary} />
                    <Choices
                      legend="Decision outcome"
                      options={OUTCOMES}
                      value={read.draft.outcome}
                      onChange={(outcome) => {
                        decisionChecks.reset();
                        read.updateDraft({ outcome, reason: '', expiresAt: '' });
                      }}
                    />
                    {accepting ? (
                      <Field {...decisionChecks.field('expiresAt')} label="Acceptance expiry (local date and time)">
                        <TextInput
                          type="datetime-local"
                          value={read.draft.expiresAt}
                          onChange={(event) => read.updateDraft({ expiresAt: event.target.value })}
                        />
                      </Field>
                    ) : (
                      <Field {...decisionChecks.field('reason')} label="Refusal reason">
                        <TextInput
                          maxLength={FIELD_LIMITS.ELIGIBILITY_REASON}
                          value={read.draft.reason}
                          onChange={(event) => read.updateDraft({ reason: event.target.value })}
                        />
                      </Field>
                    )}
                    <FormActions>
                      <PageAction
                        label="Preview company decision"
                        busy={running === 'decision'}
                        busyLabel="Previewing…"
                        disabled={read.busy || read.refreshing || !appointment}
                        onClick={() => {
                          if (decisionChecks.check()) {
                            setActionOpener(document.activeElement as HTMLElement | null);
                            track('decision', read.previewDecision());
                          }
                        }}
                      />
                    </FormActions>
                  </Section>
                )}
                {read.selectedRecord.outcome === 'accepted' && (
                  <Section title="Revoke this acceptance">
                    <ErrorSummary {...revocationChecks.summary} />
                    <Field {...revocationChecks.field('reason')} label="Revocation reason">
                      <TextInput
                        maxLength={FIELD_LIMITS.ELIGIBILITY_REASON}
                        value={revocationReason}
                        onChange={(event) => {
                          read.cancel();
                          setRevocationReason(event.target.value);
                        }}
                      />
                    </Field>
                    <FormActions>
                      <PageAction
                        label="Prepare acceptance revocation"
                        busy={running === 'revocation'}
                        busyLabel="Preparing…"
                        disabled={read.busy || read.refreshing || !canApprove}
                        onClick={() => {
                          if (revocationChecks.check()) {
                            setActionOpener(document.activeElement as HTMLElement | null);
                            track('revocation', read.prepareRevocation(read.selectedRecord!, revocationReason));
                          }
                        }}
                      />
                    </FormActions>
                  </Section>
                )}
              </>
            )}
          </div>
          {read.action && (
            <ActionConfirmation
              action={read.action}
              busy={read.busy}
              confirm={read.confirm}
              cancel={read.cancel}
              opener={actionOpener}
            />
          )}
        </>
      )}
      <div hidden={!!read.action || !read.companyUuid}>
        <CompanyWalletInstructions active={!read.action} />
      </div>
    </Page>
  );
}
