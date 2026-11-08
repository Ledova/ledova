import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { BuildingsIcon } from 'phosphor-react-native';
import { COMPANY_TYPES, FIELD_LIMITS, useSignupCompanyRegistration } from '@ledova/shared';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import { ScreenHeader } from '../../../components/header';
import { Field } from '../../../components/register/RegisterFields';
import { SelectField } from '../../../components/SelectField';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useCompanyStyles } from '../../../hooks/useCompanyStyles';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { orderSubmissionSession } from '../../../services/orderSubmissions';
import { layout } from '../../../styles';

export function CompanyRegistrationScreen() {
  const theme = useAppTheme();
  const formStyles = useCompanyStyles();
  const styles = useThemedStyles((theme) => ({
    container: { flex: 1 },
    content: {
      flexGrow: 1,
      justifyContent: 'center' as const,
      paddingHorizontal: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
      paddingBottom: layout.screenBottomPadding,
      gap: theme.spacing.md,
    },
    waiting: {
      flex: 1,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    card: {
      backgroundColor: theme.colors.surface.raised,
      borderColor: theme.colors.border.default,
      borderWidth: 1,
      borderRadius: theme.borderRadius.xl,
      padding: theme.spacing.md,
      gap: theme.spacing.lg,
    },
    problem: { gap: theme.spacing.sm },
    back: { alignSelf: 'center' as const, padding: theme.spacing.sm },
    link: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.interactive.active,
    },
  }));
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const {
    form,
    errors,
    generalError,
    loadError,
    hasLoadedForm,
    canSubmit,
    isLoading,
    isSubmitting,
    setFieldValue,
    handleSubmit,
    retryLoad,
  } = useSignupCompanyRegistration(orderSubmissionSession);
  const retry = () => void retryLoad();

  if (isLoading || (loadError && !hasLoadedForm)) {
    return (
      <GradientBackground>
        <SafeAreaView style={styles.waiting}>
          {isLoading ? (
            <>
              <ActivityIndicator color={theme.colors.interactive.active} />
              <Text style={formStyles.muted}>Loading your company details…</Text>
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={formStyles.heading}>
                Unable to load
              </Text>
              <Text accessibilityRole="alert" style={formStyles.error}>
                {loadError}
              </Text>
              <PrimaryButton onPress={retry}>Try again</PrimaryButton>
            </>
          )}
        </SafeAreaView>
      </GradientBackground>
    );
  }

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ScreenHeader
              icon={<BuildingsIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} />}
              title="Company details"
              subtitle="Enter your company's basic information. Company information is provided by the company."
            />
            {!!loadError && (
              <View style={styles.problem}>
                <Text accessibilityRole="alert" style={formStyles.error}>
                  {loadError}
                </Text>
                <TouchableOpacity disabled={isSubmitting} onPress={retry} accessibilityRole="button">
                  <Text style={styles.link}>Try again</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.card}>
              {!!generalError && (
                <Text accessibilityRole="alert" style={formStyles.error}>
                  {generalError}
                </Text>
              )}
              <Field
                label="Registered company name"
                value={form.name}
                maxLength={FIELD_LIMITS.COMPANY_NAME}
                placeholder="Your Company Pty Ltd"
                editable={!isSubmitting}
                error={errors.name?.join(' ')}
                onChange={(value) => setFieldValue('name', value)}
              />
              <Field
                label="Trading name (optional)"
                value={form.tradingName}
                maxLength={FIELD_LIMITS.COMPANY_NAME}
                placeholder="Trading as…"
                editable={!isSubmitting}
                error={errors.tradingName?.join(' ')}
                onChange={(value) => setFieldValue('tradingName', value)}
              />
              <SelectField
                label="Company type"
                value={form.companyType}
                options={COMPANY_TYPES}
                disabled={isSubmitting}
                error={errors.companyType?.join(' ')}
                onChange={(value) => setFieldValue('companyType', value)}
              />
              <Field
                label="ACN"
                value={form.acn}
                maxLength={FIELD_LIMITS.ACN}
                placeholder="123 456 789"
                keyboardType="number-pad"
                editable={!isSubmitting}
                error={errors.acn?.join(' ')}
                onChange={(value) => setFieldValue('acn', value)}
              />
              <Field
                label="ABN (optional)"
                value={form.abn}
                maxLength={FIELD_LIMITS.ABN}
                placeholder="12 345 678 901"
                keyboardType="number-pad"
                editable={!isSubmitting}
                error={errors.abn?.join(' ')}
                onChange={(value) => setFieldValue('abn', value)}
              />
              <PrimaryButton
                loading={isSubmitting}
                disabled={isSubmitting || !canSubmit}
                onPress={() => void handleSubmit(() => navigation.navigate('Review'))}
                fullWidth
              >
                Continue
              </PrimaryButton>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() => navigation.navigate('UserProfile')}
              style={styles.back}
            >
              <Text style={styles.link}>Go back</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GradientBackground>
  );
}
