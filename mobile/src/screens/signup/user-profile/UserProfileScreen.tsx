import { View, Text, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import { ScreenHeader, SignOutLink } from '../../../components/header';
import { DatePickerField } from '../../../components/date-picker';
import { Field } from '../../../components/register/RegisterFields';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { UserIcon, WarningCircleIcon, HouseIcon, PhoneIcon } from 'phosphor-react-native';
import { CountrySelector } from './components/CountrySelector';
import { useRole, parseDateString, formatDateToString, useSignupUserProfile } from '@ledova/shared';
import { layout } from '../../../styles';
import { useAppTheme, useThemedStyles } from '../../../contexts';

export function UserProfileScreen() {
  const theme = useAppTheme();
  const { isCompany, isLoading: roleLoading } = useRole();
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
    },
    keyboardView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
      paddingBottom: layout.screenBottomPadding,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      marginTop: theme.spacing.md,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.muted,
    },
    formContainer: {
      backgroundColor: theme.colors.surface.raised,
      borderRadius: theme.borderRadius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      padding: theme.spacing.md,
    },
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.error.default + '1A',
      borderWidth: 1,
      borderColor: theme.colors.form.borderError,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    errorText: {
      color: theme.colors.form.error,
      fontSize: theme.fontSize.sm,
      marginLeft: theme.spacing.sm,
      flex: 1,
    },
    fieldContainer: {
      marginBottom: theme.spacing.lg,
    },
    continueButton: {
      marginTop: theme.spacing.md,
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
    },
    backText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.subtle,
      textAlign: 'center',
    },
    backLink: {
      color: theme.colors.interactive.active,
      fontWeight: theme.fontWeight.semibold,
    },
    errorStateContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.xl,
    },
    errorStateTitle: {
      fontSize: theme.fontSize.xl,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    errorStateMessage: {
      fontSize: theme.fontSize.base,
      color: theme.colors.text.muted,
      textAlign: 'center',
      marginBottom: theme.spacing.xl,
    },
  }));
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const {
    form,
    errors,
    generalError,
    isLoading,
    isSubmitting,
    selectedCountry,
    countries,
    setFieldValue,
    handleCountryChange,
    handleSubmit,
    retryLoad,
  } = useSignupUserProfile();

  const handleContinue = async () => {
    await handleSubmit(() => {
      navigation.navigate(isCompany ? 'CompanyRegistration' : 'Review');
    });
  };

  const handleBack = () => {
    navigation.navigate('AccountType');
  };

  if (isLoading || roleLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <SignOutLink />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.interactive.active} />
          <Text style={styles.loadingText}>Loading profile data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (generalError && !form.fullName && !isSubmitting) {
    return (
      <SafeAreaView style={styles.container}>
        <SignOutLink />
        <View style={styles.errorStateContainer}>
          <WarningCircleIcon
            size={theme.icon.sizes.md}
            color={theme.colors.status.error.text}
            weight={theme.icon.weights.regular}
          />
          <Text style={styles.errorStateTitle}>Unable to load profile</Text>
          <Text style={styles.errorStateMessage}>{generalError}</Text>
          <PrimaryButton onPress={retryLoad}>Try again</PrimaryButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <SignOutLink disabled={isSubmitting} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <ScreenHeader
              icon={
                <UserIcon
                  size={theme.icon.sizes.md}
                  color={theme.colors.text.muted}
                  weight={theme.icon.weights.regular}
                />
              }
              title="Personal details"
            />

            <View style={styles.formContainer}>
              {generalError && (
                <View style={styles.errorContainer}>
                  <WarningCircleIcon
                    size={theme.icon.sizes.md}
                    color={theme.colors.status.error.icon}
                    weight={theme.icon.weights.regular}
                  />
                  <Text style={styles.errorText}>{generalError}</Text>
                </View>
              )}

              <View style={styles.fieldContainer}>
                <Field
                  filled
                  label="Full name"
                  icon={
                    <UserIcon
                      size={theme.icon.sizes.md}
                      color={theme.colors.text.subtle}
                      weight={theme.icon.weights.regular}
                    />
                  }
                  placeholder="John Doe"
                  value={form.fullName}
                  onChange={(text) => setFieldValue('fullName', text)}
                  editable={!isSubmitting}
                  error={errors.fullName?.join(' ')}
                />
              </View>

              <View style={styles.fieldContainer}>
                <DatePickerField
                  label="Date of birth"
                  value={parseDateString(form.dateOfBirth)}
                  onChange={(date) => setFieldValue('dateOfBirth', formatDateToString(date))}
                  placeholder="DD/MM/YYYY"
                  maximumDate={new Date()}
                  minimumDate={new Date(1900, 0, 1)}
                  disabled={isSubmitting}
                  error={errors.dateOfBirth?.join(' ')}
                />
              </View>

              <View style={styles.fieldContainer}>
                <Field
                  filled
                  label="Phone number"
                  icon={
                    <>
                      <PhoneIcon
                        size={theme.icon.sizes.md}
                        color={theme.colors.text.subtle}
                        weight={theme.icon.weights.regular}
                      />
                      <CountrySelector
                        countries={countries}
                        selectedCountry={selectedCountry}
                        onCountryChange={handleCountryChange}
                        disabled={isSubmitting}
                      />
                    </>
                  }
                  placeholder="416 004 021"
                  value={form.phoneNumber}
                  onChange={(text) => setFieldValue('phoneNumber', text)}
                  keyboardType="phone-pad"
                  editable={!isSubmitting}
                  error={errors.phoneNumber?.join(' ')}
                />
              </View>

              <View style={styles.fieldContainer}>
                <Field
                  filled
                  label="Residential address"
                  hint="Include street number, city, state and postcode"
                  icon={
                    <HouseIcon
                      size={theme.icon.sizes.md}
                      color={theme.colors.text.subtle}
                      weight={theme.icon.weights.regular}
                    />
                  }
                  placeholder={'123 Main Street\nSydney NSW 2000'}
                  value={form.residentialAddress}
                  onChange={(text) => setFieldValue('residentialAddress', text)}
                  multiline
                  rows={3}
                  editable={!isSubmitting}
                  error={errors.residentialAddress?.join(' ')}
                />
              </View>

              <PrimaryButton onPress={handleContinue} loading={isSubmitting} fullWidth style={styles.continueButton}>
                Continue
              </PrimaryButton>
            </View>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.backSection}>
              <Text style={styles.backText}>
                <Text style={styles.backLink} onPress={() => !isSubmitting && handleBack()}>
                  Go back
                </Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GradientBackground>
  );
}
