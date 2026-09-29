import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getCompanies, getErrorMessage, formatDate } from '@ledova/shared';
import type { CertifierBody, InvestorCategory, InvestorClassification } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { GradientBackground } from '../../components/GradientBackground';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { CATEGORIES, CERTIFIER_BODIES, REASON_TEXT, WHOLESALE_ONLY_NOTICE } from './constants';
import { useInvestorEligibility } from './useInvestorEligibility';
import { useDocumentUpload } from '../../hooks/useDocumentUpload';

const CLAIM_ERROR_FALLBACK = 'The claim was refused. Please check the details and try again.';

function claimState(claim: InvestorClassification) {
  if (claim.isLive) return claim.expiresAt ? `Verified until ${formatDate(claim.expiresAt)}` : 'Verified';
  if (claim.isExpired) return 'Expired';
  if (claim.status === 'submitted') return 'Awaiting review';
  return claim.statusDisplay;
}

export function InvestorEligibilityScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const {
    eligibility,
    classifications,
    isLoading,
    hasError,
    isRefreshing,
    refresh,
    submitClaim,
    isSubmitting,
    deleteClaim,
    isDeleting,
  } = useInvestorEligibility();
  const [category, setCategory] = useState<InvestorCategory | null>(null);
  const document = useDocumentUpload(eligibility?.account);
  const { file, clear: clearDocument } = document;
  const draftGeneration = useRef(0);
  const [declaredBasis, setDeclaredBasis] = useState('');
  const [company, setCompany] = useState('');
  const [certificateIssuedAt, setCertificateIssuedAt] = useState('');
  const [certifierName, setCertifierName] = useState('');
  const [certifierBody, setCertifierBody] = useState<CertifierBody | ''>('');
  const [certifierMembershipNumber, setCertifierMembershipNumber] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ uuid: string; message: string } | null>(null);
  const needsCompany = category === 'associated_person';
  const needsCertifier = category === 'accountant_certificate';
  const companiesQuery = useQuery({
    queryKey: ['companies'],
    queryFn: () => getCompanies(apiClient),
    enabled: needsCompany,
  });
  const companies = companiesQuery.isError ? [] : (companiesQuery.data?.data.results ?? []);
  const reset = useCallback(() => {
    draftGeneration.current++;
    setCategory(null);
    clearDocument();
    setDeclaredBasis('');
    setCompany('');
    setCertificateIssuedAt('');
    setCertifierName('');
    setCertifierBody('');
    setCertifierMembershipNumber('');
    setClaimError(null);
  }, [clearDocument]);
  useEffect(reset, [reset]);
  function changeField<T>(setter: (value: T) => void, value: T) {
    draftGeneration.current++;
    setter(value);
  }
  const openClaim = classifications.some((claim) => claim.status === 'submitted');
  const busy = isSubmitting || document.isSubmitting;
  const blocked = isLoading || hasError || isRefreshing || openClaim || isDeleting;
  const isComplete =
    !!file &&
    !!category &&
    !!eligibility?.account &&
    declaredBasis.trim() !== '' &&
    (!needsCompany ||
      (!companiesQuery.isError && !companiesQuery.isFetching && companies.some((item) => item.uuid === company))) &&
    (!needsCertifier ||
      (certificateIssuedAt !== '' &&
        certifierName.trim() !== '' &&
        certifierBody !== '' &&
        certifierMembershipNumber.trim() !== ''));
  const pickFile = async () => {
    setClaimError(null);
    try {
      await document.pick();
    } catch (error) {
      setClaimError(getErrorMessage(error, 'Please choose the document again.'));
    }
  };
  const handleSubmit = async () => {
    if (!isComplete || !category || !eligibility?.account || blocked || busy || document.isPicking) return;
    const generation = draftGeneration.current;
    setClaimError(null);
    try {
      const current = await document.submit(({ file: uploadFile, sessionEpoch }) =>
        submitClaim({
          sessionEpoch,
          category,
          declaredBasis: declaredBasis.trim(),
          file: uploadFile,
          company: needsCompany ? company : undefined,
          certificateIssuedAt: needsCertifier ? certificateIssuedAt : undefined,
          certifierName: needsCertifier ? certifierName.trim() : undefined,
          certifierBody: needsCertifier ? (certifierBody as CertifierBody) : undefined,
          certifierMembershipNumber: needsCertifier ? certifierMembershipNumber.trim() : undefined,
        }),
      );
      if (current && generation === draftGeneration.current) reset();
    } catch (error) {
      setClaimError(getErrorMessage(error, CLAIM_ERROR_FALLBACK));
    }
  };
  const withdraw = async (uuid: string) => {
    if (isDeleting || busy || hasError || isRefreshing) return;
    const epoch = getSessionEpoch();
    setDeleteError(null);
    try {
      await deleteClaim(uuid);
    } catch (error) {
      if (epoch === getSessionEpoch()) {
        setDeleteError({
          uuid,
          message: getErrorMessage(error, 'Your claim could not be withdrawn.') ?? 'Your claim could not be withdrawn.',
        });
      }
    }
  };
  const close = () => {
    if (!busy && !document.isPicking) reset();
  };
  const spec = CATEGORIES.find((item) => item.category === category);
  const readNotice = hasError ? (
    <View style={styles.group}>
      <Text accessibilityRole="alert" style={styles.message}>
        Verification information could not be loaded. Try again before continuing.
      </Text>
      <Action label="Try again" onPress={() => void refresh()} disabled={isRefreshing} />
    </View>
  ) : isRefreshing ? (
    <Text style={styles.message}>Refreshing verification information…</Text>
  ) : null;

  return (
    <GradientBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing && !isLoading}
            onRefresh={() => void refresh()}
            tintColor={theme.colors.brand.default}
          />
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          Verification
        </Text>
        {isLoading ? (
          <View style={styles.group}>
            <ActivityIndicator color={theme.colors.brand.default} />
            <Text style={styles.message}>Loading verification…</Text>
          </View>
        ) : hasError ? (
          readNotice
        ) : (
          <>
            <Section title="Investor status">
              <Text style={styles.message}>
                {eligibility?.isEligible
                  ? 'You can see and subscribe to offerings'
                  : 'You cannot subscribe to offerings yet'}
              </Text>
              {!eligibility?.isEligible &&
                (eligibility?.reasons ?? []).map((reason) => (
                  <Text key={reason} style={styles.message}>
                    {REASON_TEXT[reason] ?? reason}
                  </Text>
                ))}
              <Text style={styles.help}>{WHOLESALE_ONLY_NOTICE}</Text>
            </Section>
            <Section title="How you qualify">
              {openClaim && (
                <Text style={styles.message}>
                  Your evidence is awaiting review. Withdraw that claim before submitting another.
                </Text>
              )}
              {CATEGORIES.map((item, index) => (
                <View key={item.category} style={[styles.item, index === CATEGORIES.length - 1 && styles.lastItem]}>
                  <Text style={styles.label}>
                    {item.label} ({item.section})
                  </Text>
                  <Text style={styles.message}>{item.evidence}</Text>
                  {classifications.some((claim) => claim.category === item.category && claim.isLive) && (
                    <Text style={styles.message}>Verified</Text>
                  )}
                  <Action
                    label="Attach evidence"
                    accessibilityLabel={`Attach evidence for ${item.label}`}
                    onPress={() => changeField(setCategory, item.category)}
                    disabled={openClaim || !eligibility?.account || isRefreshing || isDeleting}
                  />
                </View>
              ))}
            </Section>
            <Section title="Your claims">
              {classifications.length === 0 ? (
                <Text style={styles.message}>You have not made a claim yet.</Text>
              ) : (
                classifications.map((claim, index) => (
                  <View key={claim.uuid} style={[styles.item, index === classifications.length - 1 && styles.lastItem]}>
                    <Text style={styles.label}>{claim.categoryDisplay}</Text>
                    <Rows>
                      <Row label="Status">{claimState(claim)}</Row>
                      <Row label="Submitted">{formatDate(claim.createdAt)}</Row>
                    </Rows>
                    {claim.rejectionReason && <Text style={styles.message}>{claim.rejectionReason}</Text>}
                    {deleteError?.uuid === claim.uuid && (
                      <Text accessibilityRole="alert" style={styles.error}>
                        {deleteError.message}
                      </Text>
                    )}
                    {claim.status === 'submitted' && (
                      <Action
                        label="Withdraw claim"
                        accessibilityLabel={`Withdraw ${claim.categoryDisplay} claim`}
                        onPress={() => void withdraw(claim.uuid)}
                        disabled={isDeleting || isRefreshing}
                      />
                    )}
                  </View>
                ))
              )}
            </Section>
            <Section title="What happens next">
              <Text style={styles.message}>
                The operator reviews your evidence and records its expiry. Verified evidence makes offerings available;
                renew it before it expires.
              </Text>
            </Section>
          </>
        )}
      </ScrollView>
      <CustomModal
        visible={category !== null}
        title={spec ? `Claim: ${spec.label}` : 'Claim'}
        onClose={close}
        busy={busy || document.isPicking}
        dismissLabel="Close claim"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing && !isLoading}
            onRefresh={() => {
              if (!busy && !document.isPicking) void refresh();
            }}
            enabled={!busy && !document.isPicking}
            tintColor={theme.colors.brand.default}
          />
        }
        actions={
          <Action
            label={busy ? 'Submitting…' : 'Submit for review'}
            onPress={() => void handleSubmit()}
            disabled={!isComplete || blocked || busy || document.isPicking}
            primary
          />
        }
      >
        <Text style={styles.message}>{spec?.evidence}</Text>
        {readNotice}
        {openClaim && (
          <Text accessibilityRole="alert" style={styles.message}>
            A claim is now awaiting review. Withdraw it before submitting another.
          </Text>
        )}
        {claimError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {claimError}
          </Text>
        )}
        {needsCompany && (
          <View style={styles.group}>
            <Text style={styles.label}>Issuer</Text>
            {companiesQuery.isLoading ? (
              <Text style={styles.message}>Loading issuers…</Text>
            ) : companiesQuery.isError ? (
              <>
                <Text accessibilityRole="alert" style={styles.error}>
                  Issuers could not be loaded.
                </Text>
                <Action
                  label="Try issuers again"
                  onPress={() => void companiesQuery.refetch()}
                  disabled={companiesQuery.isFetching}
                />
              </>
            ) : companies.length === 0 ? (
              <Text style={styles.message}>No issuer is available for this account.</Text>
            ) : (
              <View style={styles.choices}>
                {companies.map((item) => (
                  <Choice
                    key={item.uuid}
                    label={item.name}
                    selected={company === item.uuid}
                    accessibilityRole="radio"
                    onPress={() => changeField(setCompany, item.uuid)}
                  />
                ))}
              </View>
            )}
          </View>
        )}
        {needsCertifier && (
          <>
            <Text style={styles.label}>Certificate date (YYYY-MM-DD)</Text>
            <TextInput
              accessibilityLabel="Certificate date"
              value={certificateIssuedAt}
              onChangeText={(value) => changeField(setCertificateIssuedAt, value)}
              placeholder="2026-01-31"
              style={styles.input}
            />
            <Text style={styles.label}>Professional body</Text>
            <View style={styles.choices}>
              {CERTIFIER_BODIES.map((body) => (
                <Choice
                  key={body.value}
                  label={body.label}
                  selected={certifierBody === body.value}
                  accessibilityRole="radio"
                  onPress={() => changeField(setCertifierBody, body.value)}
                />
              ))}
            </View>
            <Text style={styles.label}>Accountant name</Text>
            <TextInput
              accessibilityLabel="Accountant name"
              value={certifierName}
              onChangeText={(value) => changeField(setCertifierName, value)}
              style={styles.input}
            />
            <Text style={styles.label}>Membership number</Text>
            <TextInput
              accessibilityLabel="Membership number"
              value={certifierMembershipNumber}
              onChangeText={(value) => changeField(setCertifierMembershipNumber, value)}
              style={styles.input}
            />
          </>
        )}
        <Text style={styles.label}>Basis for the claim</Text>
        <TextInput
          accessibilityLabel="Basis for the claim"
          value={declaredBasis}
          onChangeText={(value) => changeField(setDeclaredBasis, value)}
          placeholder="Describe why this category applies to you"
          style={[styles.input, styles.textArea]}
          multiline
        />
        <Action
          label={file ? file.name : 'Attach evidence (PDF or image, max 10 MB)'}
          onPress={() => void pickFile()}
          disabled={document.isPicking || busy}
        />
        <Text style={styles.help}>
          Submitting declares that this category applies to you and that the evidence attached is genuine.{' '}
          {WHOLESALE_ONLY_NOTICE}
        </Text>
      </CustomModal>
    </GradientBackground>
  );
}

function useStyles() {
  return useThemedStyles((theme) => ({
    content: { paddingHorizontal: 24, paddingTop: theme.spacing.smd, paddingBottom: 36, gap: 28 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 40, color: theme.colors.text.primary },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.muted },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 13, lineHeight: 20, color: theme.colors.text.muted },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 15, color: theme.colors.text.primary },
    error: { fontFamily: theme.fontFamily.regular, fontSize: 15, color: theme.colors.status.error.text },
    group: { gap: theme.spacing.smd },
    item: {
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.subtle,
    },
    lastItem: { paddingBottom: 0, borderBottomWidth: 0 },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
      padding: theme.spacing.smd,
      fontFamily: theme.fontFamily.regular,
      fontSize: 15,
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.surface.raised,
    },
    textArea: { minHeight: 90, textAlignVertical: 'top' as const },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm },
  }));
}
