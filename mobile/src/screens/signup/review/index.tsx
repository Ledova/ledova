import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { ClipboardIcon } from 'phosphor-react-native';
import { layout } from '../../../styles';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useReview } from './useReview';
import {
  apiErrorSentence,
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  formatPhoneWithCountryCode,
  getAddressDisplayLines,
  parseAddress,
  formatSourceOfFunds,
  formatIntendedUse,
} from '@ledova/shared';
import { PUBLIC_LINKS } from '../../../config/publicLinks';
import { Action, Choice } from '../../../components/Ledger';
import { useDocumentUpload } from '../../../hooks/useDocumentUpload';
import { getSessionEpoch } from '../../../services/sessionScope';

export function ReviewScreen() {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
      paddingBottom: layout.screenBottomPadding,
      gap: theme.spacing.md,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    loadingText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.xl,
    },
    errorTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.form.error,
      marginBottom: theme.spacing.sm,
    },
    errorMessage: {
      fontSize: theme.fontSize.base,
      color: theme.colors.status.error.icon,
      textAlign: 'center',
    },
    header: {
      alignItems: 'center',
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.md,
    },
    iconContainer: {
      padding: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    title: {
      fontSize: theme.fontSize.xl,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.xs,
    },
    subtitle: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      textAlign: 'center',
      paddingHorizontal: theme.spacing.md,
      lineHeight: theme.lineHeight.normal * theme.fontSize.sm,
    },
    card: {
      backgroundColor: theme.colors.surface.raised,
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
    },
    cardHeader: {
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.subtle,
    },
    cardContent: {
      padding: theme.spacing.lg,
    },
    sectionTitle: {
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
    },
    infoList: {
      gap: theme.spacing.md,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.subtle,
    },
    infoRowVertical: {
      gap: theme.spacing.sm,
    },
    infoLabel: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      fontWeight: theme.fontWeight.medium,
    },
    infoValue: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
      fontWeight: theme.fontWeight.medium,
      textAlign: 'right',
      flex: 1,
    },
    infoValueVertical: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
      fontWeight: theme.fontWeight.medium,
      textAlign: 'left',
    },
    errorText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.status.error.icon,
    },
    termsText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.body,
      lineHeight: theme.lineHeight.normal * theme.fontSize.sm,
    },
    linkText: {
      color: theme.colors.interactive.active,
      textDecorationLine: 'underline',
    },
    buttonContainer: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.lg,
    },
    completeButton: {
      shadowColor: theme.colors.interactive.active,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 4,
    },
    validationText: {
      marginBottom: theme.spacing.md,
      fontSize: theme.fontSize.sm,
      color: theme.colors.status.error.icon,
      textAlign: 'center',
    },
    divider: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: theme.spacing.xl,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: theme.colors.border.default,
    },
    dividerText: {
      marginHorizontal: theme.spacing.md,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.subtle,
      fontWeight: theme.fontWeight.medium,
    },
    backSection: {
      alignItems: 'center',
      paddingVertical: theme.spacing.md,
    },
    backLink: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.interactive.active,
      fontWeight: theme.fontWeight.semibold,
    },
  }));
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const {
    data,
    company,
    isCompany,
    isLoading,
    error,
    completionError,
    completeSignup,
    isSubmitting,
    canCompleteSignup,
    retryLoad,
    authorityRequest,
    authorityReady,
    authorityError,
    authorityEvidence,
    authorityEvidenceLocked,
    setAuthorityEvidence,
    authorityAccepted,
    setAuthorityAccepted,
    allowTeamDelegation,
    setAllowTeamDelegation,
    resetAuthorityRequest,
    isResettingAuthority,
  } = useReview();
  const document = useDocumentUpload(isCompany ? company?.uuid : null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const busy = isSubmitting || isResettingAuthority || document.isPicking || document.isSubmitting;
  useEffect(() => {
    const file = document.file as unknown as Blob | null;
    if (!authorityRequest && !authorityReady && authorityEvidence !== file) setAuthorityEvidence(file);
  }, [document.file, authorityRequest, authorityReady, authorityEvidence, setAuthorityEvidence]);
  const pickEvidence = async () => {
    if (busy || authorityEvidenceLocked || authorityRequest || authorityReady) return;
    const epoch = getSessionEpoch();
    setEvidenceError(null);
    try {
      await document.pick();
    } catch (cause) {
      if (epoch === getSessionEpoch())
        setEvidenceError(apiErrorSentence(cause, 'The evidence could not be selected. Try again.'));
    }
  };
  const finish = async () => {
    if (!canCompleteSignup || busy) return;
    try {
      if (isCompany && !authorityRequest && !authorityReady) {
        await document.submit(async ({ assertCurrent }) => {
          assertCurrent();
          await completeSignup();
        });
      } else {
        await completeSignup();
      }
    } catch {
      return;
    }
  };

  const handleBack = () => {
    navigation.navigate(isCompany ? 'CompanyRegistration' : 'FinancialProfile');
  };

  const handleOpenTerms = async () => {
    try {
      const supported = await Linking.canOpenURL(PUBLIC_LINKS.termsOfService);
      if (supported) {
        await Linking.openURL(PUBLIC_LINKS.termsOfService);
      } else {
        Alert.alert('Error', `Unable to open URL: ${PUBLIC_LINKS.termsOfService}`);
      }
    } catch {
      Alert.alert('Error', 'Failed to open Terms of Service');
    }
  };

  const handleOpenPrivacyPolicy = async () => {
    try {
      const supported = await Linking.canOpenURL(PUBLIC_LINKS.privacyPolicy);
      if (supported) {
        await Linking.openURL(PUBLIC_LINKS.privacyPolicy);
      } else {
        Alert.alert('Error', `Unable to open URL: ${PUBLIC_LINKS.privacyPolicy}`);
      }
    } catch {
      Alert.alert('Error', 'Failed to open Privacy Policy');
    }
  };

  if (isLoading) {
    return (
      <GradientBackground>
        <SafeAreaView style={styles.container}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.interactive.active} />
            <Text style={styles.loadingText}>Loading review data...</Text>
          </View>
        </SafeAreaView>
      </GradientBackground>
    );
  }

  if (error) {
    return (
      <GradientBackground>
        <SafeAreaView style={styles.container}>
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Error Loading Data</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <PrimaryButton onPress={retryLoad}>Try Again</PrimaryButton>
          </View>
        </SafeAreaView>
      </GradientBackground>
    );
  }

  const { userProfile, financialProfile } = data;

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <ClipboardIcon
                size={theme.icon.sizes.md}
                color={theme.colors.text.muted}
                weight={theme.icon.weights.regular}
              />
            </View>
            <Text style={styles.title}>Review & Confirm</Text>
            <Text style={styles.subtitle}>Please review your information before completing signup</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionTitle}>Personal Information</Text>
            </View>
            <View style={styles.cardContent}>
              {userProfile ? (
                <View style={styles.infoList}>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Full Name:</Text>
                    <Text style={styles.infoValue}>{userProfile.fullName}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Phone:</Text>
                    <Text style={styles.infoValue}>
                      {formatPhoneWithCountryCode(userProfile.phoneCountryCode, userProfile.phoneNumber)}
                    </Text>
                  </View>
                  {getAddressDisplayLines(parseAddress(userProfile.residentialAddress ?? '')).map((line, index) => (
                    <View key={index} style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{line.label}</Text>
                      <Text style={styles.infoValue}>{line.value}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.errorText}>No personal information found.</Text>
              )}
            </View>
          </View>

          {isCompany ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.sectionTitle}>Company Information</Text>
              </View>
              <View style={styles.cardContent}>
                {company ? (
                  <View style={styles.infoList}>
                    <Text style={styles.infoLabel}>Company information is provided by the company.</Text>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Company:</Text>
                      <Text style={styles.infoValue}>{company.name}</Text>
                    </View>
                    {company.tradingName ? (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Trading As:</Text>
                        <Text style={styles.infoValue}>{company.tradingName}</Text>
                      </View>
                    ) : null}
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>ACN:</Text>
                      <Text style={styles.infoValue}>{company.acn}</Text>
                    </View>
                    {company.abn ? (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>ABN:</Text>
                        <Text style={styles.infoValue}>{company.abn}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.errorText}>No company information found.</Text>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.sectionTitle}>Financial Profile</Text>
              </View>
              <View style={styles.cardContent}>
                {financialProfile ? (
                  <View style={styles.infoList}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Source of Funds:</Text>
                      <Text style={styles.infoValue}>{formatSourceOfFunds(financialProfile.sourceOfFunds)}</Text>
                    </View>
                    {financialProfile.sourceOfFundsOtherText && (
                      <View style={styles.infoRowVertical}>
                        <Text style={styles.infoLabel}>Source of Funds (Other):</Text>
                        <Text style={styles.infoValueVertical}>{financialProfile.sourceOfFundsOtherText}</Text>
                      </View>
                    )}
                    {financialProfile.intendedUse && (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Intended Use:</Text>
                        <Text style={styles.infoValue}>{formatIntendedUse(financialProfile.intendedUse)}</Text>
                      </View>
                    )}
                    {financialProfile.intendedUseOtherText && (
                      <View style={styles.infoRowVertical}>
                        <Text style={styles.infoLabel}>Intended Use (Other):</Text>
                        <Text style={styles.infoValueVertical}>{financialProfile.intendedUseOtherText}</Text>
                      </View>
                    )}
                    {financialProfile.occupation && (
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Occupation:</Text>
                        <Text style={styles.infoValue}>{financialProfile.occupation}</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <Text style={styles.errorText}>No financial profile found.</Text>
                )}
              </View>
            </View>
          )}

          {isCompany && company && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.sectionTitle}>Company representative</Text>
              </View>
              <View style={styles.cardContent}>
                <View style={styles.infoList}>
                  {authorityReady ? (
                    <Text style={styles.infoValueVertical}>
                      Your current company administrator appointment is confirmed.
                    </Text>
                  ) : (
                    <>
                      {authorityRequest ? (
                        <>
                          <Text style={styles.infoValueVertical}>
                            Retained evidence: {authorityRequest.originalFilename}
                          </Text>
                          <Text style={styles.infoLabel}>
                            Your permissions:{' '}
                            {authorityRequest.requestedCapabilities
                              .map(
                                (value) =>
                                  COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value,
                              )
                              .join(', ')}
                          </Text>
                          <Text style={styles.infoLabel}>
                            Permissions you can delegate:{' '}
                            {authorityRequest.delegatableCapabilities
                              .map(
                                (value) =>
                                  COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value,
                              )
                              .join(', ') || 'None'}
                          </Text>
                          {authorityRequest.status === 'pending' && (
                            <Action
                              label="Use different evidence"
                              disabled={busy}
                              onPress={() => {
                                void resetAuthorityRequest()
                                  .then(() => document.clear())
                                  .catch(() => {});
                              }}
                            />
                          )}
                        </>
                      ) : (
                        <>
                          <Text style={styles.infoLabel}>
                            Choose a PDF, PNG or JPEG up to 10 MB that supports your authority to act for {company.name}
                            . Your evidence stays private to your account.
                          </Text>
                          {document.file && <Text style={styles.infoValueVertical}>{document.file.name}</Text>}
                          <Action
                            label={document.file ? 'Replace evidence' : 'Choose representative evidence'}
                            disabled={busy || authorityEvidenceLocked}
                            onPress={() => void pickEvidence()}
                          />
                          {document.file && (
                            <Action
                              label="Remove selected evidence"
                              disabled={busy || authorityEvidenceLocked}
                              onPress={document.clear}
                            />
                          )}
                          <Choice
                            label="Allow me to appoint company administrators"
                            accessibilityRole="checkbox"
                            selected={allowTeamDelegation}
                            disabled={busy || authorityEvidenceLocked}
                            onPress={() => setAllowTeamDelegation(!allowTeamDelegation)}
                          />
                          <Text style={styles.infoLabel}>
                            Your initial appointment manages company information and team. Delegation is granted only
                            when you select this option and is retained with your declaration.
                          </Text>
                          {authorityEvidenceLocked && (
                            <Text style={styles.infoLabel}>
                              The upload outcome is not confirmed. Retry with the same evidence and permissions.
                            </Text>
                          )}
                        </>
                      )}
                      <Text style={styles.termsText}>{COMPANY_AUTHORITY_DECLARATION}</Text>
                      <Text style={styles.infoLabel}>Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}.</Text>
                      <Choice
                        label={`Accept authorisation declaration for ${company.name}`}
                        accessibilityRole="checkbox"
                        selected={authorityAccepted}
                        disabled={busy}
                        onPress={() => setAuthorityAccepted(!authorityAccepted)}
                      />
                    </>
                  )}
                  <Text style={styles.infoLabel}>
                    An appointment does not activate the company or approve a share issue. Those company decisions
                    remain separate.
                  </Text>
                  {(authorityError || evidenceError) && (
                    <Text accessibilityRole="alert" style={styles.errorText}>
                      {authorityError || evidenceError}
                    </Text>
                  )}
                  <Action label="Refresh setup" disabled={busy} onPress={() => void retryLoad()} />
                </View>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.cardContent}>
              <Text style={styles.termsText}>
                By completing signup, you accept the{' '}
                <Text style={styles.linkText} onPress={handleOpenTerms}>
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text style={styles.linkText} onPress={handleOpenPrivacyPolicy}>
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>
            <View style={styles.buttonContainer}>
              {!canCompleteSignup && (
                <Text style={styles.validationText}>Please ensure all information is complete to proceed.</Text>
              )}
              {completionError && (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {completionError}
                </Text>
              )}
              <PrimaryButton
                onPress={() => void finish()}
                loading={isSubmitting || document.isSubmitting || isResettingAuthority}
                disabled={!canCompleteSignup || busy}
                fullWidth
                style={styles.completeButton}
              >
                {isCompany ? 'Finish company setup' : 'Complete Signup'}
              </PrimaryButton>
            </View>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.backSection} onPress={handleBack} disabled={busy}>
            <Text style={styles.backLink}>Go Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}
