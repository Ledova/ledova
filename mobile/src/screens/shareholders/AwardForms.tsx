import { Keyboard, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  REGISTER_AWARD_COPY as COPY,
  UPLOAD_RULE,
  useAwardAdjustmentForm,
  useAwardForm,
  useAwardVestingForm,
  useErrorSummary,
  type OwnCompanyAppointment,
  type Person,
  type RegisterAward,
} from '@ledova/shared';
import { Action, FormActions } from '../../components/Ledger';
import { Field, FileField } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { PersonSelect } from '../../components/PersonSelect';
import { useShareholderStyles } from './useShareholderStyles';

const DATE = {
  placeholder: 'YYYY-MM-DD',
  keyboardType: 'numbers-and-punctuation',
  autoCapitalize: 'none',
  autoCorrect: false,
} as const;

function useFormStyles() {
  return useThemedStyles((theme) => {
    const ruled = { paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.border.subtle };
    return {
      ruled: { ...ruled, gap: theme.spacing.md },
      fields: { gap: theme.spacing.md },
    };
  });
}

function FormFailure({ error, held }: { error: string; held: boolean }) {
  const styles = useCompanyStyles();
  return (
    <>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {held && <Text style={styles.muted}>{COPY.RECOVERY_NOTE}</Text>}
    </>
  );
}

export function AwardForm({
  company,
  token,
  people,
  appointment,
  guard,
  blocked,
  onRecorded,
  onCancel,
  onHeldChange,
  visible = true,
  canPrepare = true,
}: {
  company: string;
  token: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onCancel: () => void;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
  canPrepare?: boolean;
}) {
  const look = useShareholderStyles();
  const form = useFormStyles();
  const award = useAwardForm({
    company,
    token,
    people,
    appointment,
    guard,
    blocked,
    onRecorded,
    onHeldChange,
    visible,
    canPrepare,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const checks = useErrorSummary(award.problems);
  const locked = award.busy || blocked || award.held || !canPrepare;
  const cancel = (
    <Action
      label="Cancel"
      accessibilityLabel="Cancel (award preparation)"
      disabled={award.busy || blocked || award.held}
      onPress={() => {
        Keyboard.dismiss();
        onCancel();
      }}
    />
  );
  if (!visible) return <FormActions>{cancel}</FormActions>;
  return (
    <View style={form.ruled}>
      <View style={form.fields}>
        <PersonSelect
          label="Recipient"
          people={people.filter((row) => row.walletless && row.particularsRetained)}
          value={award.member}
          onChange={award.setMember}
          allowNew
          disabled={locked}
        />
        <Field
          label={COPY.SHARES}
          value={award.shares}
          keyboardType="number-pad"
          maxLength={FIELD_LIMITS.REGISTER_SHARES}
          editable={!locked}
          error={checks.field('shares').error}
          onChange={(shares) => award.setShares(shares.trim())}
        />
        {award.member === 'new' && (
          <>
            <Field
              label="Name"
              value={award.name}
              maxLength={FIELD_LIMITS.NAME}
              editable={!locked}
              error={checks.field('name').error}
              onChange={award.setName}
            />
            <Field
              label="Residential address"
              value={award.address}
              maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
              multiline
              editable={!locked}
              error={checks.field('address').error}
              onChange={award.setAddress}
            />
          </>
        )}
      </View>
      <View style={form.ruled}>
        <Text accessibilityRole="header" style={look.heading}>
          Agreement
        </Text>
        <Field
          label="Date"
          value={award.termsOn}
          {...DATE}
          editable={!locked}
          error={checks.field('termsOn').error}
          onChange={(termsOn) => award.setTermsOn(termsOn.trim())}
        />
        <FileField label="Document" disabled={locked} error={checks.field('file').error} onFile={award.setFile} />
        <Field
          label="Terms"
          value={award.terms}
          multiline
          rows={4}
          maxLength={FIELD_LIMITS.TERMS}
          editable={!locked}
          error={checks.field('terms').error}
          onChange={award.setTerms}
        />
      </View>
      <View style={form.ruled}>
        <Text accessibilityRole="header" style={look.heading}>
          Vesting
        </Text>
        <View style={form.fields}>
          <Field
            label="Schedule"
            value={award.schedule}
            multiline
            rows={6}
            maxLength={FIELD_LIMITS.TERMS}
            editable={!locked}
            error={checks.field('schedule').error}
            onChange={award.setSchedule}
          />
          <Text style={look.muted}>
            Record each actual vesting event separately; dates do not vest or issue shares.
          </Text>
        </View>
      </View>
      <FormFailure error={award.error} held={award.held} />
      <FormActions>
        {cancel}
        <Action
          primary
          label={award.busy ? 'Recording award…' : COPY.SUBMIT}
          disabled={award.busy || blocked || (!award.held && !canPrepare)}
          onPress={() => {
            if (!award.held && !checks.check()) return;
            Keyboard.dismiss();
            void award.submit();
          }}
        />
      </FormActions>
    </View>
  );
}

export function AwardVestingForm({
  award,
  appointment,
  guard,
  blocked,
  onRecorded,
  onCancel,
  onHeldChange,
  visible = true,
  canPrepare = true,
}: {
  award: RegisterAward;
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onCancel: () => void;
  onHeldChange?: (held: boolean) => void;
  visible?: boolean;
  canPrepare?: boolean;
}) {
  const look = useShareholderStyles();
  const form = useFormStyles();
  const vesting = useAwardVestingForm({
    award,
    appointment,
    guard,
    blocked,
    onRecorded,
    onHeldChange,
    visible,
    canPrepare,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const checks = useErrorSummary(vesting.problems);
  const locked = vesting.busy || blocked || vesting.held || !canPrepare;
  const cancel = (
    <Action
      label="Cancel"
      accessibilityLabel={visible ? `Cancel (vesting for ${award.recipientName})` : 'Cancel (vesting recovery)'}
      disabled={vesting.busy || blocked || vesting.held}
      onPress={() => {
        Keyboard.dismiss();
        onCancel();
      }}
    />
  );
  if (!visible) return <FormActions>{cancel}</FormActions>;
  return (
    <View style={form.ruled}>
      <Text accessibilityRole="header" style={look.heading}>
        Record vesting
      </Text>
      <Field
        label="Shares in this event"
        value={vesting.shares}
        keyboardType="number-pad"
        maxLength={FIELD_LIMITS.REGISTER_SHARES}
        editable={!locked}
        error={checks.field('shares').error}
        onChange={(shares) => vesting.setShares(shares.trim())}
      />
      <Field
        label="Vesting date"
        value={vesting.vestedOn}
        {...DATE}
        editable={!locked}
        error={checks.field('vestedOn').error}
        onChange={(vestedOn) => vesting.setVestedOn(vestedOn.trim())}
      />
      <FileField label="Document" disabled={locked} error={checks.field('file').error} onFile={vesting.setFile} />
      <FormFailure error={vesting.error} held={vesting.held} />
      <FormActions>
        {cancel}
        <Action
          primary
          label={vesting.busy ? 'Recording vesting…' : 'Record vesting'}
          disabled={vesting.busy || blocked || (!vesting.held && !canPrepare)}
          onPress={() => {
            if (!vesting.held && !checks.check()) return;
            Keyboard.dismiss();
            void vesting.submit();
          }}
        />
      </FormActions>
    </View>
  );
}

export function AwardAdjustmentForm(
  props: Omit<Parameters<typeof useAwardAdjustmentForm>[0], 'newKey' | 'session'> & { onCancel: () => void },
) {
  const styles = useCompanyStyles();
  const form = useFormStyles();
  const change = useAwardAdjustmentForm({ ...props, newKey: randomUUID, session: orderSubmissionSession });
  const checks = useErrorSummary(change.problems);
  const locked = change.busy || props.blocked || change.held || !props.canPrepare;
  const cancel = (
    <Action
      label="Cancel"
      accessibilityLabel={
        props.visible
          ? `Cancel (entitlement change for ${props.award.recipientName})`
          : 'Cancel (entitlement change recovery)'
      }
      disabled={change.busy || props.blocked || change.held}
      onPress={() => {
        Keyboard.dismiss();
        props.onCancel();
      }}
    />
  );
  if (!props.visible) return <FormActions>{cancel}</FormActions>;
  return (
    <View style={form.ruled}>
      <Text style={styles.muted}>{props.vesting ? COPY.REVERSAL_NOTE : COPY.END_NOTE}</Text>
      {!!props.vesting && <Text style={styles.text}>Original vesting: {props.vestingLabel}</Text>}
      {props.vesting ? (
        <Field
          label={COPY.REVERSED_SHARES}
          value={change.reversedShares}
          keyboardType="number-pad"
          maxLength={FIELD_LIMITS.REGISTER_SHARES}
          editable={!locked}
          error={checks.field('reversedShares').error}
          onChange={(shares) => change.setReversedShares(shares.trim())}
        />
      ) : (
        <>
          <Field
            label={COPY.END_UNVESTED}
            value={change.unvestedShares}
            keyboardType="number-pad"
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            editable={!locked}
            error={checks.field('unvestedShares').error}
            onChange={(shares) => change.setUnvestedShares(shares.trim())}
          />
          <Field
            label={COPY.END_VESTED}
            value={change.vestedShares}
            keyboardType="number-pad"
            maxLength={FIELD_LIMITS.REGISTER_SHARES}
            editable={!locked}
            error={checks.field('vestedShares').error}
            onChange={(shares) => change.setVestedShares(shares.trim())}
          />
        </>
      )}
      <Field
        label={COPY.COMPANY_EVENT_ON}
        value={change.companyEventOn}
        {...DATE}
        editable={!locked}
        error={checks.field('companyEventOn').error}
        onChange={(companyEventOn) => change.setCompanyEventOn(companyEventOn.trim())}
      />
      <Field
        label={COPY.REASON}
        value={change.reason}
        multiline
        maxLength={FIELD_LIMITS.REASON}
        editable={!locked}
        error={checks.field('reason').error}
        onChange={change.setReason}
      />
      <FileField
        label={COPY.ADJUSTMENT_DOCUMENT}
        hint={UPLOAD_RULE.HINT}
        disabled={locked}
        error={checks.field('file').error}
        onFile={change.setFile}
      />
      <FormFailure error={change.error} held={change.held} />
      <FormActions>
        {cancel}
        <Action
          primary
          label={change.busy ? 'Recording change…' : props.vesting ? COPY.REVERSE : COPY.END}
          disabled={change.busy || props.blocked || (!change.held && !props.canPrepare)}
          onPress={() => {
            if (!change.held && !checks.check()) return;
            Keyboard.dismiss();
            void change.submit();
          }}
        />
      </FormActions>
    </View>
  );
}
