import * as Crypto from 'expo-crypto';
import { RefreshControl, Text, TextInput, View } from 'react-native';
import { ELIGIBILITY_RECORDS_NOTICE, useParticipantEligibilityRecords } from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useCompanyStyles } from '../company-register/styles';
import { EligibilityConfirmation } from './EligibilityConfirmation';
import { EligibilityExpiry } from './EligibilityExpiry';
import { WalletNomination } from './WalletNomination';
import { EligibilityRecord } from './EligibilityRecord';

export function ParticipantEligibilityScreen() {
  const styles = useCompanyStyles();
  const records = useParticipantEligibilityRecords(apiClient, Crypto.randomUUID, orderSubmissionSession);
  const source = records.sources.find((item) => item.uuid === records.draft.source);
  const product = source?.category === 'product_value';
  const blocked = records.busy || records.refreshing || records.loading;
  return (
    <Page
      title="Eligibility requests"
      lede={ELIGIBILITY_RECORDS_NOTICE}
      keyboardShouldPersistTaps="handled"
      actions={<Action label="Refresh eligibility records" disabled={blocked} onPress={() => void records.refresh()} />}
      refreshControl={
        <RefreshControl refreshing={records.refreshing && !records.loading} onRefresh={() => void records.refresh()} />
      }
    >
      {records.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {records.error}
        </Text>
      )}
      {records.selectedRequestUuid && (
        <WalletNomination
          key={records.selectedRequestUuid}
          requestUuid={records.selectedRequestUuid}
          guardRequest={() => records.guardOwnRequest(records.selectedRequestUuid)}
        />
      )}
      {!records.owner ? (
        <Text style={styles.muted}>Your signed-in account must be checked before opening eligibility requests.</Text>
      ) : records.loading ? (
        <Text style={styles.muted}>Loading your eligibility records…</Text>
      ) : (
        <>
          <Section title="Prepare a sharing request">
            <Text style={styles.muted}>
              Select your submitted evidence or retained historical evidence and enter the company or offering UUID you
              were given. Preview the exact summary before sharing it. Original files and private financial details are
              not shared here.
            </Text>
            {records.sources.length === 0 ? (
              <Text style={styles.muted}>
                You have no evidence sources. Attach your evidence in Verification first.
              </Text>
            ) : (
              records.sources.map((item) => (
                <Choice
                  key={item.uuid}
                  label={`${item.categoryDisplay} · ${item.uuid}`}
                  accessibilityLabel={`Select evidence ${item.uuid}`}
                  accessibilityRole="radio"
                  selected={records.draft.source === item.uuid}
                  disabled={blocked}
                  onPress={() =>
                    records.updateDraft({
                      source: item.uuid,
                      company: item.category === 'associated_person' ? (item.company ?? '') : '',
                      offering: '',
                      quantity: '',
                    })
                  }
                />
              ))
            )}
            {product ? (
              <>
                <Text style={styles.heading}>Approved offering UUID</Text>
                <TextInput
                  accessibilityLabel="Approved offering UUID"
                  value={records.draft.offering}
                  editable={!blocked}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  onChangeText={(offering) => records.updateDraft({ offering })}
                />
                <Text style={styles.heading}>Whole-share quantity</Text>
                <TextInput
                  accessibilityLabel="Whole-share quantity"
                  value={records.draft.quantity}
                  editable={!blocked}
                  inputMode="numeric"
                  style={styles.input}
                  onChangeText={(quantity) => records.updateDraft({ quantity })}
                />
              </>
            ) : (
              <>
                <Text style={styles.heading}>Company UUID</Text>
                <TextInput
                  accessibilityLabel="Company UUID"
                  value={records.draft.company}
                  editable={!blocked}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  onChangeText={(company) => records.updateDraft({ company })}
                />
              </>
            )}
            <EligibilityExpiry
              label="Requested expiry"
              value={records.draft.requestedExpiresAt}
              disabled={blocked}
              onChange={(requestedExpiresAt) => records.updateDraft({ requestedExpiresAt })}
            />
            <Action
              label="Preview sharing request"
              primary
              disabled={
                blocked ||
                !source ||
                !records.draft.requestedExpiresAt ||
                (product ? !records.draft.offering || !records.draft.quantity : !records.draft.company)
              }
              onPress={() => void records.previewRequest()}
            />
          </Section>
          {records.action && (
            <EligibilityConfirmation
              key={`${records.action.kind}/${records.action.key}`}
              action={records.action}
              busy={blocked}
              confirm={records.confirm}
              cancel={records.cancel}
            />
          )}
          <Section title="Your request history">
            {records.records.length === 0 ? (
              <Text style={styles.muted}>You have no company eligibility requests.</Text>
            ) : (
              records.records.map((record) => (
                <Choice
                  key={record.uuid}
                  label={`${record.company} · ${record.outcome}`}
                  accessibilityLabel={`Open eligibility request ${record.uuid}`}
                  selected={records.selectedRecord?.uuid === record.uuid}
                  disabled={blocked}
                  onPress={() => records.selectRecord(record.uuid)}
                />
              ))
            )}
          </Section>
          {records.selectedRecord && (
            <Section title="Your selected request">
              <EligibilityRecord record={records.selectedRecord} />
              {['pending', 'accepted'].includes(records.selectedRecord.outcome) &&
                !records.selectedRecord.withdrawal && (
                  <Action
                    label="Review request withdrawal"
                    disabled={blocked}
                    onPress={() => records.prepareWithdrawal(records.selectedRecord!)}
                  />
                )}
              <View style={styles.group}>
                <Action label="Close request" disabled={records.busy} onPress={() => records.selectRecord(null)} />
              </View>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
