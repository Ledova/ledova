import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { getCompanies, getErrorMessage, formatDate } from '@ledova/shared';
import type { CertifierBody, InvestorCategory, InvestorClassification } from '@ledova/shared';
import { useAppTheme, useThemedStyles, overlayColors } from '../../contexts';
import { GradientBackground } from '../../components/GradientBackground';
import { Action, Row, Section } from '../../components/Ledger';
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
      if (epoch === getSessionEpoch()) setDeleteError(getErrorMessage(error, 'Your claim could not be withdrawn.'));
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
              {CATEGORIES.map((item) => (
                <View key={item.category} style={styles.item}>
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
              {deleteError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {deleteError}
                </Text>
              )}
              {classifications.length === 0 ? (
                <Text style={styles.message}>You have not made a claim yet.</Text>
              ) : (
                classifications.map((claim) => (
                  <View key={claim.uuid} style={styles.item}>
                    <Text style={styles.label}>{claim.categoryDisplay}</Text>
                    <Row label="Status">{claimState(claim)}</Row>
                    <Row label="Submitted">{formatDate(claim.createdAt)}</Row>
                    {claim.rejectionReason && <Text style={styles.message}>{claim.rejectionReason}</Text>}
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
      <Modal visible={category !== null} animationType="fade" transparent onRequestClose={close}>
        <SafeAreaView style={styles.overlay}>
          <Pressable style={styles.backdrop} accessibilityLabel="Close claim" onPress={close} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalPosition}>
            <View style={styles.modal} accessibilityViewIsModal>
              <ScrollView
                contentContainerStyle={styles.form}
                keyboardShouldPersistTaps="handled"
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
              >
                <Text accessibilityRole="header" style={styles.modalTitle}>
                  {spec ? `Claim: ${spec.label}` : 'Claim'}
                </Text>
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
                      companies.map((item) => (
                        <Pressable
                          key={item.uuid}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: company === item.uuid }}
                          onPress={() => changeField(setCompany, item.uuid)}
                          style={[styles.option, company === item.uuid && styles.selected]}
                        >
                          <Text style={styles.message}>{item.name}</Text>
                        </Pressable>
                      ))
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
                    {CERTIFIER_BODIES.map((body) => (
                      <Pressable
                        key={body.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: certifierBody === body.value }}
                        onPress={() => changeField(setCertifierBody, body.value)}
                        style={[styles.option, certifierBody === body.value && styles.selected]}
                      >
                        <Text style={styles.message}>{body.label}</Text>
                      </Pressable>
                    ))}
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
              </ScrollView>
              <View style={styles.footer}>
                <Action label="Cancel" onPress={close} disabled={busy || document.isPicking} />
                <Action
                  label={busy ? 'Submitting…' : 'Submit for review'}
                  onPress={() => void handleSubmit()}
                  disabled={!isComplete || blocked || busy || document.isPicking}
                  primary
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </GradientBackground>
  );
}

function useStyles() {
  return useThemedStyles((theme) => ({
    content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36, gap: 28 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 40, color: theme.colors.text.primary },
    modalTitle: { fontFamily: theme.fontFamily.display, fontSize: 26, color: theme.colors.text.primary },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.muted },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 13, lineHeight: 20, color: theme.colors.text.muted },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 15, color: theme.colors.text.primary },
    error: { fontFamily: theme.fontFamily.regular, fontSize: 15, color: theme.colors.status.error.text },
    group: { gap: 12 },
    item: { gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    overlay: { flex: 1, backgroundColor: overlayColors.modal, justifyContent: 'center' as const },
    backdrop: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
    modalPosition: { maxHeight: '100%' as const, padding: 16, alignItems: 'center' as const },
    modal: {
      maxHeight: '100%' as const,
      width: '100%' as const,
      maxWidth: 480,
      backgroundColor: theme.colors.surface.base,
      borderRadius: 10,
      overflow: 'hidden' as const,
    },
    form: { padding: 20, gap: 14 },
    footer: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 12,
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.default,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
      padding: 12,
      fontFamily: theme.fontFamily.regular,
      fontSize: 15,
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.surface.raised,
    },
    textArea: { minHeight: 90, textAlignVertical: 'top' as const },
    option: { borderWidth: 1, borderColor: theme.colors.border.default, padding: 12, borderRadius: 6 },
    selected: { borderColor: theme.colors.brand.default, backgroundColor: theme.colors.surface.raised },
  }));
}
