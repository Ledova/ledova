import { SelectField } from '@components/SelectField';
import { Choices } from '@components/Choices';
import { CompanyPicker } from '@components/CompanyPicker';
import { useState } from 'react';
import {
  DESTINATIONS,
  ELIGIBILITY_RECORDS_NOTICE,
  isCurrentEligibilityAppointment,
  useCompanyEligibilityRecords,
  formatDate,
} from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { ActionConfirmation, EligibilityHistory, RecordsList, TextField } from '@components/eligibility';
import { CompanyWalletInstructions } from './CompanyWalletInstructions';
import { scopeLabels } from '@pages/company/shared/appointments';

const OUTCOMES = [
  ['accepted', 'Accept'],
  ['refused', 'Refuse'],
] as const;
export default function CompanyEligibilityPage() {
  const read = useCompanyEligibilityRecords(() => crypto.randomUUID());
  const [revocationReason, setRevocationReason] = useState('');
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
          {read.error && (
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
                setRevocationReason('');
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
              <RecordsList
                records={read.records}
                select={(uuid) => {
                  read.selectRecord(uuid);
                  setRevocationReason('');
                }}
                selected={read.selectedRecord?.uuid}
              />
            </Section>
          )}
          {read.selectedRecord && (
            <>
              <EligibilityHistory record={read.selectedRecord} />
              {read.selectedRecord.outcome === 'pending' && (
                <Section title="Prepare the exact company decision">
                  <Choices
                    legend="Decision outcome"
                    options={OUTCOMES}
                    value={read.draft.outcome}
                    onChange={(outcome) => read.updateDraft({ outcome, reason: '', expiresAt: '' })}
                  />
                  {read.draft.outcome === 'accepted' ? (
                    <TextField
                      label="Acceptance expiry (local date and time)"
                      type="datetime-local"
                      value={read.draft.expiresAt}
                      onChange={(expiresAt) => read.updateDraft({ expiresAt })}
                    />
                  ) : (
                    <TextField
                      label="Refusal reason"
                      value={read.draft.reason}
                      onChange={(reason) => read.updateDraft({ reason })}
                    />
                  )}
                  <PageAction
                    label="Preview company decision"
                    disabled={read.busy || read.refreshing || !appointment}
                    onClick={() => void read.previewDecision()}
                  />
                </Section>
              )}
              {read.selectedRecord.outcome === 'accepted' && (
                <Section title="Revoke this acceptance">
                  <TextField
                    label="Revocation reason"
                    value={revocationReason}
                    onChange={(value) => {
                      read.cancel();
                      setRevocationReason(value);
                    }}
                  />
                  <PageAction
                    label="Prepare acceptance revocation"
                    disabled={read.busy || read.refreshing || !canApprove || !revocationReason.trim()}
                    onClick={() => void read.prepareRevocation(read.selectedRecord!, revocationReason)}
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
