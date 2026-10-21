import { SelectField } from '@components/SelectField';
import { Choices } from '@components/Choices';
import { CompanyPicker } from '@components/CompanyPicker';
import { useState } from 'react';
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
} from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { Pager } from '@components/List';
import { PAGE_SIZE, useFirstPageWhenGone, useListParams } from '@hooks/useListParams';
import { Page, PageAction } from '@components/Page';
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
  const list = useListParams(['outcome']);
  const outcome = QUEUE_OUTCOMES.find(([value]) => value && value === list.filters.outcome)?.[0] as
    QueueOutcome | undefined;
  const read = useCompanyEligibilityRecords(() => crypto.randomUUID(), undefined, {
    page: list.page,
    pageSize: PAGE_SIZE,
    outcome,
  });
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
    <Page
      narrow
      loading={read.loading}
      lede={ELIGIBILITY_RECORDS_NOTICE}
      actions={
        <PageAction
          label="Refresh records"
          disabled={read.busy || read.refreshing}
          onClick={() => void read.refresh()}
        />
      }
    >
      {!read.owner ? (
        <p>Your signed-in account must be checked before opening these records.</p>
      ) : (
        <>
          {read.error && !gone && (
            <p role="alert" className="text-sm text-error-light">
              {read.error}
            </p>
          )}
          <Section title="Your personal company authority">
            <LinkRow to={DESTINATIONS.companyTeam.path} label="Your appointments and company team" />
            <p className="text-sm text-text-muted">
              Current personal prepare or approve authority permits reading this company&apos;s queue and preparing a
              decision. Recording a decision or revocation requires your own approve appointment.
            </p>
            <CompanyPicker
              companies={read.companies}
              value={read.companyUuid}
              onChange={(uuid) => {
                read.setCompany(uuid);
                forget();
                if (list.page > 1) list.setPage(1, true);
              }}
            />
            {read.companies.length === 0 && <p>No current personal prepare or approve appointments are available.</p>}
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
                      reference: item.uuid.slice(0, 8),
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
                  {outcome ? 'No requests match.' : 'No requests recorded.'}
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
                  <PageAction
                    label="Preview company decision"
                    busy={running === 'decision'}
                    busyLabel="Previewing…"
                    disabled={read.busy || read.refreshing || !appointment}
                    onClick={() => {
                      if (decisionChecks.check()) track('decision', read.previewDecision());
                    }}
                  />
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
                  <PageAction
                    label="Prepare acceptance revocation"
                    busy={running === 'revocation'}
                    busyLabel="Preparing…"
                    disabled={read.busy || read.refreshing || !canApprove}
                    onClick={() => {
                      if (revocationChecks.check())
                        track('revocation', read.prepareRevocation(read.selectedRecord!, revocationReason));
                    }}
                  />
                </Section>
              )}
            </>
          )}
          {read.action && (
            <ActionConfirmation action={read.action} busy={read.busy} confirm={read.confirm} cancel={read.cancel} />
          )}
        </>
      )}
      <CompanyWalletInstructions />
    </Page>
  );
}
