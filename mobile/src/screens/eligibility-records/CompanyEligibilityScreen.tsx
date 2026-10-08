import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { RefreshControl, Text, TextInput } from 'react-native';
import {
  ELIGIBILITY_RECORDS_NOTICE,
  isCurrentEligibilityAppointment,
  useCompanyEligibilityRecords,
  type CompanyEligibilityRequest,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useCompanyStyles } from '../company-register/styles';
import { EligibilityConfirmation } from './EligibilityConfirmation';
import { EligibilityExpiry } from './EligibilityExpiry';
import { CompanyWalletInstructions } from './CompanyWalletInstructions';
import { EligibilityRecord } from './EligibilityRecord';

function RevocationForm({
  record,
  blocked,
  prepare,
  cancel,
}: {
  record: CompanyEligibilityRequest;
  blocked: boolean;
  prepare: (record: CompanyEligibilityRequest, reason: string) => void;
  cancel: () => void;
}) {
  const styles = useCompanyStyles();
  const [reason, setReason] = useState('');
  return (
    <>
      <Text style={styles.heading}>Revocation reason</Text>
      <TextInput
        accessibilityLabel="Revocation reason"
        value={reason}
        maxLength={500}
        multiline
        editable={!blocked}
        style={styles.input}
        onChangeText={(value) => {
          cancel();
          setReason(value);
        }}
      />
      <Action
        label="Review acceptance revocation"
        disabled={blocked || !reason.trim()}
        onPress={() => prepare(record, reason)}
      />
    </>
  );
}

export function CompanyEligibilityScreen() {
  const styles = useCompanyStyles();
  const records = useCompanyEligibilityRecords(apiClient, Crypto.randomUUID, orderSubmissionSession);
  const blocked = records.busy || records.loading || records.refreshing;
  const appointments = records.appointments.filter(
    (item) =>
      item.company === records.companyUuid &&
      isCurrentEligibilityAppointment(item) &&
      item.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'),
  );
  const appointment = appointments.find((item) => item.uuid === records.appointmentUuid);
  const canApprove = !!appointment?.capabilities.includes('approve');
  return (
    <Page
      title="Company eligibility"
      lede={ELIGIBILITY_RECORDS_NOTICE}
      keyboardShouldPersistTaps="handled"
      actions={<Action label="Refresh company eligibility" disabled={blocked} onPress={() => void records.refresh()} />}
      refreshControl={
        <RefreshControl refreshing={records.refreshing && !records.loading} onRefresh={() => void records.refresh()} />
      }
    >
      <CompanyWalletInstructions />
      {records.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {records.error}
        </Text>
      )}
      {!records.owner ? (
        <Text style={styles.muted}>Your signed-in account must be checked before opening company eligibility.</Text>
      ) : records.loading ? (
        <Text style={styles.muted}>Loading your eligibility appointments…</Text>
      ) : (
        <>
          <Section title="Company and personal appointment">
            <Text style={styles.muted}>
              Your personal Prepare or Approve permission for this exact company controls this queue. Preparing does not
              authorise a company decision.
            </Text>
            {records.companies.length === 0 ? (
              <Text style={styles.muted}>You have no current personal Prepare or Approve appointment.</Text>
            ) : (
              records.companies.map((company) => (
                <Choice
                  key={company.uuid}
                  label={company.name}
                  accessibilityLabel={`Select eligibility company ${company.name}`}
                  accessibilityRole="radio"
                  selected={records.companyUuid === company.uuid}
                  disabled={blocked}
                  onPress={() => records.setCompany(company.uuid)}
                />
              ))
            )}
            {appointments.map((item) => (
              <Choice
                key={item.uuid}
                label={`${item.capabilities.join(', ')} · ${item.uuid}`}
                accessibilityLabel={`Select eligibility appointment ${item.uuid}`}
                accessibilityRole="radio"
                selected={records.appointmentUuid === item.uuid}
                disabled={blocked}
                onPress={() => records.setAppointment(item.uuid)}
              />
            ))}
          </Section>
          {records.companyUuid && (
            <Section title="Company request queue and history">
              {records.records.length === 0 ? (
                <Text style={styles.muted}>No eligibility requests are recorded for this company.</Text>
              ) : (
                records.records.map((record) => (
                  <Choice
                    key={record.uuid}
                    label={`${record.userAccount} · ${record.outcome}`}
                    accessibilityLabel={`Open company eligibility request ${record.uuid}`}
                    selected={records.selectedRecord?.uuid === record.uuid}
                    disabled={blocked}
                    onPress={() => records.selectRecord(record.uuid)}
                  />
                ))
              )}
            </Section>
          )}
          {records.selectedRecord && (
            <Section title="Selected company request">
              <EligibilityRecord record={records.selectedRecord} />
              {!records.selectedRecord.decision && !records.selectedRecord.withdrawal && (
                <>
                  <Choice
                    label="Accept this request"
                    accessibilityRole="radio"
                    selected={records.draft.outcome === 'accepted'}
                    disabled={blocked || !appointment}
                    onPress={() => records.updateDraft({ outcome: 'accepted', reason: '' })}
                  />
                  <Choice
                    label="Refuse this request"
                    accessibilityRole="radio"
                    selected={records.draft.outcome === 'refused'}
                    disabled={blocked || !appointment}
                    onPress={() => records.updateDraft({ outcome: 'refused', expiresAt: '' })}
                  />
                  {records.draft.outcome === 'accepted' ? (
                    <EligibilityExpiry
                      label="Acceptance expiry"
                      value={records.draft.expiresAt}
                      disabled={blocked || !appointment}
                      onChange={(expiresAt) => records.updateDraft({ expiresAt })}
                    />
                  ) : (
                    <>
                      <Text style={styles.heading}>Refusal reason</Text>
                      <TextInput
                        accessibilityLabel="Refusal reason"
                        value={records.draft.reason}
                        maxLength={500}
                        multiline
                        editable={!blocked && !!appointment}
                        style={styles.input}
                        onChangeText={(reason) => records.updateDraft({ reason })}
                      />
                    </>
                  )}
                  <Action
                    label="Preview company decision"
                    primary
                    disabled={
                      blocked ||
                      (!appointment && !records.canRetryDecision) ||
                      (records.draft.outcome === 'accepted' ? !records.draft.expiresAt : !records.draft.reason.trim())
                    }
                    onPress={() => void records.previewDecision()}
                  />
                </>
              )}
              {records.selectedRecord.outcome === 'accepted' &&
                records.selectedRecord.decision?.outcome === 'accepted' &&
                !records.selectedRecord.decision.revocation &&
                canApprove && (
                  <RevocationForm
                    key={`${records.companyUuid}/${records.appointmentUuid}/${records.selectedRecord.uuid}`}
                    record={records.selectedRecord}
                    blocked={blocked}
                    prepare={records.prepareRevocation}
                    cancel={records.cancel}
                  />
                )}
              <Action
                label="Close company request"
                disabled={records.busy}
                onPress={() => records.selectRecord(null)}
              />
            </Section>
          )}
          {records.action && (
            <EligibilityConfirmation
              key={`${records.action.kind}/${records.action.key}`}
              action={records.action}
              busy={blocked}
              confirm={records.confirm}
              cancel={records.cancel}
            />
          )}
        </>
      )}
    </Page>
  );
}
