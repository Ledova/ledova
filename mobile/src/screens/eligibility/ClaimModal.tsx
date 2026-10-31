import { useRef } from 'react';
import { Pressable, Text, View, type ScrollView } from 'react-native';
import { FileIcon, UploadSimpleIcon, XIcon } from 'phosphor-react-native';
import {
  CERTIFIER_BODY_LABELS,
  FIELD_LIMITS,
  UPLOAD_RULE,
  certifierBodies,
  formatDateToString,
  formatFileSize,
  parseDateString,
  useErrorSummary,
  type InvestorCategory,
} from '@ledova/shared';
import { ErrorSummary } from '../../components/ErrorSummary';
import { Action, Actions } from '../../components/Ledger';
import { SelectField } from '../../components/SelectField';
import { DatePickerField } from '../../components/date-picker';
import { CustomModal } from '../../components/modal';
import { CheckboxField, Field } from '../../components/register/RegisterFields';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useInvestorClaim } from './useInvestorClaim';

const CERTIFIER_BODIES = certifierBodies(CERTIFIER_BODY_LABELS.ca_anz);

export function ClaimModal({
  category,
  onClose,
  onSuccess,
  submissionBlockedReason,
  onRetry,
  isRetrying,
}: {
  category: InvestorCategory | null;
  onClose: () => void;
  onSuccess: () => void;
  submissionBlockedReason: string | null;
  onRetry?: () => void;
  isRetrying: boolean;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    blocked: { gap: theme.spacing.smd },
    secondary: { color: theme.colors.text.secondary },
    dateLabel: {
      fontFamily: theme.fontFamily.regular,
      fontWeight: theme.fontWeight.normal,
      lineHeight: 21,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.sm,
    },
    dateField: {
      height: 'auto' as const,
      paddingHorizontal: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
      backgroundColor: theme.colors.surface.raised,
    },
    dateText: { fontFamily: theme.fontFamily.regular, fontWeight: theme.fontWeight.normal },
    drop: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: theme.spacing.smd,
      paddingVertical: 40,
      paddingHorizontal: theme.spacing.lg,
      borderWidth: 2,
      borderStyle: 'dashed' as const,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
    },
    choose: { alignItems: 'center' as const, gap: theme.spacing.xs },
    hint: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
    file: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd },
    fileText: { flex: 1, minWidth: 0 },
  }));
  const claim = useInvestorClaim({ category, onSuccess, submissionBlockedReason });
  const checks = useErrorSummary(claim.problems);
  const scroll = useRef<ScrollView>(null);
  const evidenceError = claim.fileRefusal ?? checks.field('file').error;
  const dateError = checks.field('certificateIssuedAt').error;
  const busy = claim.isSubmitting || claim.isPicking;
  const close = () => {
    if (busy) return;
    claim.reset();
    checks.reset();
    onClose();
  };
  return (
    <CustomModal
      visible={category !== null}
      title={claim.spec ? `Claim: ${claim.spec.label}` : 'Claim'}
      busy={busy}
      onClose={close}
      scrollRef={scroll}
      actions={
        <Action
          label={claim.isSubmitting ? 'Saving…' : 'Save private evidence'}
          primary
          disabled={!claim.available || busy}
          onPress={() => {
            if (checks.check()) void claim.handleSubmit();
            else scroll.current?.scrollTo({ y: 0 });
          }}
        />
      }
    >
      <ErrorSummary {...checks.summary} />
      {!!submissionBlockedReason &&
        (onRetry ? (
          <View style={look.blocked}>
            <Text accessibilityRole="alert" style={styles.text}>
              {submissionBlockedReason}
            </Text>
            <Actions>
              <Action label="Try again" disabled={isRetrying} onPress={onRetry} />
            </Actions>
          </View>
        ) : (
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {submissionBlockedReason}
          </Text>
        ))}
      {!!claim.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {claim.error}
        </Text>
      )}
      <Text style={[styles.text, look.secondary]}>{claim.spec?.evidence}</Text>
      {claim.needsCertifier && (
        <>
          <View style={styles.group}>
            <DatePickerField
              label="Certificate date (UTC)"
              value={parseDateString(claim.certificateIssuedAt)}
              onChange={(date) => claim.setCertificateIssuedAt(formatDateToString(date))}
              minimumDate={parseDateString(claim.earliestCertificate)}
              maximumDate={parseDateString(claim.today)}
              labelStyle={look.dateLabel}
              fieldStyle={look.dateField}
              textStyle={look.dateText}
              disabled={busy}
            />
            {!!dateError && <Text style={styles.error}>{dateError}</Text>}
          </View>
          <SelectField
            label="Professional body"
            value={claim.certifierBody}
            options={CERTIFIER_BODIES}
            disabled={busy}
            error={checks.field('certifierBody').error}
            onChange={claim.setCertifierBody}
          />
          <Field
            label="Accountant name"
            value={claim.certifierName}
            maxLength={FIELD_LIMITS.CERTIFIER_NAME}
            editable={!busy}
            error={checks.field('certifierName').error}
            onChange={claim.setCertifierName}
          />
          <Field
            label="Membership number"
            value={claim.certifierMembershipNumber}
            maxLength={FIELD_LIMITS.MEMBERSHIP_NUMBER}
            editable={!busy}
            autoCorrect={false}
            error={checks.field('certifierMembershipNumber').error}
            onChange={claim.setCertifierMembershipNumber}
          />
        </>
      )}
      <Field
        label="Basis for the claim"
        value={claim.declaredBasis}
        multiline
        rows={3}
        placeholder="Describe, in your own words, why this category applies to you"
        editable={!busy}
        error={checks.field('declaredBasis').error}
        onChange={claim.setDeclaredBasis}
      />
      <View style={styles.group}>
        {claim.file ? (
          <View style={look.file}>
            <FileIcon size={24} color={theme.colors.brand.light} />
            <View style={look.fileText}>
              <Text numberOfLines={1} style={styles.text}>
                {claim.file.name}
              </Text>
              <Text style={look.hint}>{formatFileSize(claim.file.size)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove evidence file"
              disabled={busy}
              hitSlop={12}
              onPress={claim.removeFile}
            >
              <XIcon size={16} color={theme.colors.text.muted} />
            </Pressable>
          </View>
        ) : (
          <View style={look.drop}>
            <UploadSimpleIcon size={32} weight="light" color={theme.colors.text.muted} />
            <View style={look.choose}>
              <View>
                <Action label="Choose evidence file" disabled={busy} onPress={() => void claim.chooseFile()} />
              </View>
              <Text style={look.hint}>{UPLOAD_RULE.HINT}</Text>
            </View>
          </View>
        )}
        {!!evidenceError && (
          <Text accessibilityRole={claim.fileRefusal ? 'alert' : undefined} style={styles.error}>
            {evidenceError}
          </Text>
        )}
      </View>
      <CheckboxField
        label="I declare that this category applies to me and that the evidence attached is genuine."
        checked={claim.declarationAccepted}
        disabled={busy}
        error={checks.field('declaration').error}
        onChange={claim.setDeclarationAccepted}
      />
    </CustomModal>
  );
}
