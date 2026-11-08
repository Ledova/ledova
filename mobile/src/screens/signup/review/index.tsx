import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import { ScreenHeader } from '../../../components/header';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { ClipboardIcon } from 'phosphor-react-native';
import { layout } from '../../../styles';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useReview } from './useReview';
import { COMPANY_TYPES, formatPhoneWithCountryCode } from '@ledova/shared';
import { PUBLIC_LINKS } from '../../../config/publicLinks';
import { Fact, Rows, Section, useCardStyles } from '../../../components/Ledger';

export function ReviewScreen() {
  const theme = useAppTheme();
  const card = useCardStyles();
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
    infoList: {
      gap: theme.spacing.md,
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
    completeButton: {
      shadowColor: theme.colors.interactive.active,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 4,
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
    identityRequired,
    isLoading,
    error,
    completionError,
    completeSignup,
    isSubmitting,
    canCompleteSignup,
    retryLoad,
    authorityRequest,
    authorityError,
    resetAuthorityRequest,
    isResettingAuthority,
  } = useReview();
  const busy = isSubmitting || isResettingAuthority;
  const finish = async () => {
    if (!canCompleteSignup || busy) return;
    try {
      await completeSignup();
    } catch {
      return;
    }
  };

  const handleBack = () => {
    if (!busy) navigation.navigate(isCompany ? 'CompanyRegistration' : 'UserProfile');
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
            <Text style={styles.errorTitle}>Error loading data</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <PrimaryButton onPress={retryLoad}>Try again</PrimaryButton>
          </View>
        </SafeAreaView>
      </GradientBackground>
    );
  }

  const { userProfile } = data;

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <ScreenHeader
            icon={
              <ClipboardIcon
                size={theme.icon.sizes.md}
                color={theme.colors.text.muted}
                weight={theme.icon.weights.regular}
              />
            }
            title={isCompany ? 'Complete company setup' : 'Review & confirm'}
            subtitle={
              isCompany
                ? 'Review your saved details. Documents and team setup can wait until your dashboard.'
                : 'Please review your information before completing signup'
            }
          />

          <Section title="Personal information">
            {userProfile ? (
              <Rows>
                <Fact label="Full name" inline>
                  {userProfile.fullName ?? ''}
                </Fact>
                <Fact label="Phone" inline>
                  {formatPhoneWithCountryCode(userProfile.phoneCountryCode, userProfile.phoneNumber)}
                </Fact>
                <Fact label="Residential address" inline>
                  {userProfile.residentialAddress || 'Not provided'}
                </Fact>
              </Rows>
            ) : (
              <Text style={styles.errorText}>No personal information found.</Text>
            )}
          </Section>

          {isCompany ? (
            <Section title="Company information">
              {company ? (
                <Rows>
                  <Fact label="Company name" inline>
                    {company.name}
                  </Fact>
                  <Fact label="ACN" inline>
                    {company.acn}
                  </Fact>
                  {company.abn ? (
                    <Fact label="ABN" inline>
                      {company.abn}
                    </Fact>
                  ) : null}
                  <Fact label="Type" inline>
                    {COMPANY_TYPES.find((type) => type.value === company.companyType)?.label ??
                      company.companyType ??
                      ''}
                  </Fact>
                </Rows>
              ) : (
                <Text style={styles.errorText}>No company information found.</Text>
              )}
            </Section>
          ) : null}

          <View style={card.card}>
            {isCompany && company ? (
              <View style={styles.infoList}>
                <Text style={styles.termsText}>
                  By completing setup, you confirm that you are authorised to administer {company.name}, including
                  managing its users, and accept the{' '}
                  <Text style={styles.linkText} onPress={handleOpenTerms}>
                    Terms of Service
                  </Text>{' '}
                  on the company’s behalf.
                </Text>
                {authorityError ? (
                  <View style={styles.infoList}>
                    <Text accessibilityRole="alert" style={styles.errorText}>
                      {authorityError}
                    </Text>
                    {authorityRequest?.status === 'pending' ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => void resetAuthorityRequest().catch(() => undefined)}
                      >
                        <Text style={styles.backLink}>Update saved setup</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void retryLoad().catch(() => undefined)}
                    >
                      <Text style={styles.backLink}>Try again</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : (
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
            )}
            {identityRequired ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                This platform requires a verified identity before company setup.
              </Text>
            ) : !canCompleteSignup ? (
              <Text style={styles.errorText}>Please ensure all information is complete to proceed.</Text>
            ) : null}
            {completionError && (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {completionError}
              </Text>
            )}
            <PrimaryButton
              onPress={() => void finish()}
              loading={busy}
              disabled={!canCompleteSignup || busy}
              fullWidth
              style={styles.completeButton}
            >
              {isCompany ? 'Complete company setup' : 'Complete signup'}
            </PrimaryButton>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.backSection} onPress={handleBack} disabled={busy}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </GradientBackground>
  );
}
