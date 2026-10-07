import { useState } from 'react';
import {
  DESTINATIONS,
  ELIGIBILITY_RECORDS_NOTICE,
  isCurrentEligibilityAppointment,
  useCompanyEligibilityRecords,
} from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { LinkRow, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { ActionConfirmation, EligibilityHistory, Field, RecordsList, TextField } from './components';
import { CompanyWalletInstructions } from './CompanyWalletInstructions';

export default function CompanyEligibilityPage() {
  const read = useCompanyEligibilityRecords(apiClient, () => crypto.randomUUID());
  const [revocationReason, setRevocationReason] = useState('');
  const appointment = read.appointments.find(
    (item) => item.uuid === read.appointmentUuid && item.company === read.companyUuid,
  );
  const canApprove =
    !!appointment && isCurrentEligibilityAppointment(appointment) && appointment.capabilities.includes('approve');
  return (
    <Page
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
            <Field label="Company">
              <select
                className={FIELD_CLASS}
                value={read.companyUuid}
                onChange={(event) => {
                  read.setCompany(event.target.value);
                  setRevocationReason('');
                }}
              >
                <option value="">Select a company</option>
                {read.companies.map((item) => (
                  <option key={item.uuid} value={item.uuid}>
                    {item.name} · {item.uuid}
                  </option>
                ))}
              </select>
            </Field>
            {read.companies.length === 0 && <p>No current personal prepare or approve appointments are available.</p>}
            {read.companyUuid && (
              <Field label="Your exact decision appointment">
                <select
                  className={FIELD_CLASS}
                  value={read.appointmentUuid}
                  onChange={(event) => read.setAppointment(event.target.value)}
                >
                  <option value="">Select your appointment</option>
                  {read.appointments
                    .filter(
                      (item) =>
                        item.company === read.companyUuid &&
                        item.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'),
                    )
                    .map((item) => (
                      <option key={item.uuid} value={item.uuid}>
                        {item.uuid} · {item.capabilities.join(', ') || 'No personal actions'}
                        {!isCurrentEligibilityAppointment(item) ? ' · inactive' : ''}
                      </option>
                    ))}
                </select>
              </Field>
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
                  <Field label="Decision outcome">
                    <select
                      className={FIELD_CLASS}
                      value={read.draft.outcome}
                      onChange={(event) =>
                        read.updateDraft({
                          outcome: event.target.value as 'accepted' | 'refused',
                          reason: '',
                          expiresAt: '',
                        })
                      }
                    >
                      <option value="accepted">Accept</option>
                      <option value="refused">Refuse</option>
                    </select>
                  </Field>
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
