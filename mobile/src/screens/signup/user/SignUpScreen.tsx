import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useSignupRestart, useSignupUser } from '@ledova/shared';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { clearTokens } from '../../../services/tokenStorage';
import {
  UserPlusIcon,
  EnvelopeSimpleIcon,
  LockIcon,
  EyeIcon,
  EyeSlashIcon,
  WarningCircleIcon,
} from 'phosphor-react-native';
import { layout } from '../../../styles';
import { useAppTheme, useThemedStyles } from '../../../contexts';

export function SignUpScreen() {
  const theme = useAppTheme();
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
    },
    formContainer: {
      backgroundColor: theme.colors.surface.raised,
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      padding: theme.spacing.lg,
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
    label: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.text.body,
      marginBottom: theme.spacing.sm,
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface.tertiary,
      borderWidth: 1,
      borderColor: theme.colors.border.strong,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: theme.spacing.md,
      height: 48,
    },
    inputIcon: {
      marginRight: theme.spacing.sm,
    },
    input: {
      flex: 1,
      color: theme.colors.text.primary,
      fontSize: theme.fontSize.base,
    },
    passwordInput: {
      paddingRight: 40,
    },
    eyeButton: {
      position: 'absolute',
      right: theme.spacing.md,
      height: 48,
      justifyContent: 'center',
    },
    passwordRequirements: {
      backgroundColor: theme.colors.surface.tertiary,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      padding: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    requirementsTitle: {
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.medium,
      color: theme.colors.text.body,
      marginBottom: theme.spacing.sm,
    },
    requirement: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.xs,
    },
    requirementDot: {
      width: 6,
      height: 6,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.text.subtle,
      marginRight: theme.spacing.sm,
    },
    requirementDotError: {
      backgroundColor: theme.colors.status.error.icon,
    },
    requirementText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
    },
    requirementTextError: {
      color: theme.colors.status.error.icon,
    },
    fieldError: {
      color: theme.colors.status.error.icon,
      fontSize: theme.fontSize.xs,
      marginTop: theme.spacing.xs,
    },
    fieldNote: {
      color: theme.colors.text.muted,
      fontSize: theme.fontSize.xs,
      marginTop: theme.spacing.xs,
    },
    restartNote: {
      color: theme.colors.text.body,
      fontSize: theme.fontSize.sm,
      lineHeight: theme.lineHeight.normal * theme.fontSize.sm,
      marginBottom: theme.spacing.lg,
    },
    signUpButton: {
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
    signInSection: {
      alignItems: 'center',
    },
    signInText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.subtle,
      textAlign: 'center',
    },
    signInLink: {
      color: theme.colors.interactive.active,
      fontWeight: theme.fontWeight.semibold,
    },
  }));
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const {
    form,
    errors,
    generalError,
    isLoading,
    showPassword,
    passwordValidation,
    setFieldValue,
    togglePassword,
    handleSubmit,
  } = useSignupUser((email) => AsyncStorage.setItem('signup_email', email));
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { userProfile } = useUserProfile();
  const account = useSignupRestart(userProfile?.email ?? '', (email) => AsyncStorage.setItem('signup_email', email));

  const handleSignUp = async () => {
    await handleSubmit(() => {
      navigation.navigate('EmailConfirmation');
    });
  };

  const handleContinue = async () => {
    await account.handleSubmit(
      () => navigation.navigate('AccountType'),
      async () => {
        const retired = await clearTokens().then(
          () => true,
          () => false,
        );
        queryClient.clear();
        navigation.reset({ index: 0, routes: [{ name: 'EmailConfirmation' }] });
        if (!retired) {
          Alert.alert(
            'Email Changed',
            'Your email was changed, but this device could not confirm that your saved sign-in was removed.',
          );
        }
      },
    );
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <View style={styles.iconContainer}>
                <UserPlusIcon
                  size={theme.icon.sizes.md}
                  color={theme.colors.text.muted}
                  weight={theme.icon.weights.regular}
                />
              </View>
              <Text style={styles.title}>{isAuthenticated ? 'Your Account' : 'Create Your Account'}</Text>
            </View>

            <View style={styles.formContainer}>
              {isAuthenticated ? (
                <>
                  {account.generalError && (
                    <View style={styles.errorContainer}>
                      <WarningCircleIcon
                        size={theme.icon.sizes.md}
                        color={theme.colors.status.error.icon}
                        weight={theme.icon.weights.regular}
                      />
                      <Text style={styles.errorText}>{account.generalError}</Text>
                    </View>
                  )}
                  <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Email</Text>
                    <View style={styles.inputWrapper}>
                      <EnvelopeSimpleIcon
                        size={theme.icon.sizes.md}
                        color={theme.colors.text.subtle}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        accessibilityLabel="Email"
                        style={styles.input}
                        placeholder="your@email.com"
                        placeholderTextColor={theme.colors.form.placeholder}
                        value={account.email}
                        onChangeText={account.setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!account.isSubmitting}
                      />
                    </View>
                    {account.errors.email ? (
                      <Text style={styles.fieldError}>{account.errors.email.join(' ')}</Text>
                    ) : (
                      !account.changed && (
                        <Text style={styles.fieldNote}>Verified. Continue to keep your progress.</Text>
                      )
                    )}
                  </View>
                  {account.changed && (
                    <>
                      <Text style={styles.restartNote}>
                        Changing your email starts signup again. We will send a code to the new address and clear your
                        account type, eligibility answers, and personal and financial details. A company you have
                        already saved stays with your account.
                      </Text>
                      <View style={styles.fieldContainer}>
                        <Text style={styles.label}>Confirm new email</Text>
                        <View style={styles.inputWrapper}>
                          <EnvelopeSimpleIcon
                            size={theme.icon.sizes.md}
                            color={theme.colors.text.subtle}
                            style={styles.inputIcon}
                          />
                          <TextInput
                            accessibilityLabel="Confirm new email"
                            style={styles.input}
                            placeholder="your@email.com"
                            placeholderTextColor={theme.colors.form.placeholder}
                            value={account.confirmEmail}
                            onChangeText={account.setConfirmEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!account.isSubmitting}
                          />
                        </View>
                        {account.errors.confirmEmail && (
                          <Text style={styles.fieldError}>{account.errors.confirmEmail.join(' ')}</Text>
                        )}
                      </View>
                      <View style={styles.fieldContainer}>
                        <Text style={styles.label}>Current password</Text>
                        <View style={styles.inputWrapper}>
                          <LockIcon
                            size={theme.icon.sizes.md}
                            color={theme.colors.text.subtle}
                            style={styles.inputIcon}
                          />
                          <TextInput
                            accessibilityLabel="Current password"
                            style={styles.input}
                            placeholder="••••••••"
                            placeholderTextColor={theme.colors.form.placeholder}
                            value={account.currentPassword}
                            onChangeText={account.setCurrentPassword}
                            secureTextEntry
                            autoCapitalize="none"
                            editable={!account.isSubmitting}
                          />
                        </View>
                        {account.errors.currentPassword && (
                          <Text style={styles.fieldError}>{account.errors.currentPassword.join(' ')}</Text>
                        )}
                      </View>
                    </>
                  )}
                  <PrimaryButton
                    onPress={handleContinue}
                    loading={account.isSubmitting}
                    fullWidth
                    style={styles.signUpButton}
                  >
                    {account.changed ? 'Change email and start again' : 'Continue'}
                  </PrimaryButton>
                </>
              ) : (
                <>
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
                    <Text style={styles.label}>Email</Text>
                    <View style={styles.inputWrapper}>
                      <EnvelopeSimpleIcon
                        size={theme.icon.sizes.md}
                        color={theme.colors.text.subtle}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        accessibilityLabel="Email"
                        style={styles.input}
                        placeholder="your@email.com"
                        placeholderTextColor={theme.colors.form.placeholder}
                        value={form.email}
                        onChangeText={(text) => setFieldValue('email', text)}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!isLoading}
                      />
                    </View>
                    {errors.email && !generalError && <Text style={styles.fieldError}>{errors.email.join(' ')}</Text>}
                  </View>

                  <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Password</Text>
                    <View style={styles.inputWrapper}>
                      <LockIcon size={theme.icon.sizes.md} color={theme.colors.text.subtle} style={styles.inputIcon} />
                      <TextInput
                        accessibilityLabel="Password"
                        style={[styles.input, styles.passwordInput]}
                        placeholder="••••••••"
                        placeholderTextColor={theme.colors.form.placeholder}
                        value={form.password}
                        onChangeText={(text) => setFieldValue('password', text)}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        editable={!isLoading}
                      />
                      <TouchableOpacity onPress={togglePassword} style={styles.eyeButton} disabled={isLoading}>
                        {showPassword ? (
                          <EyeSlashIcon
                            size={theme.icon.sizes.md}
                            color={theme.colors.text.subtle}
                            weight={theme.icon.weights.regular}
                          />
                        ) : (
                          <EyeIcon
                            size={theme.icon.sizes.md}
                            color={theme.colors.text.subtle}
                            weight={theme.icon.weights.regular}
                          />
                        )}
                      </TouchableOpacity>
                    </View>

                    <View style={styles.passwordRequirements}>
                      <Text style={styles.requirementsTitle}>Password must:</Text>
                      <View style={styles.requirement}>
                        <View
                          style={[
                            styles.requirementDot,
                            form.password && !passwordValidation.lengthValid && styles.requirementDotError,
                          ]}
                        />
                        <Text
                          style={[
                            styles.requirementText,
                            form.password && !passwordValidation.lengthValid && styles.requirementTextError,
                          ]}
                        >
                          Be at least 8 characters long
                        </Text>
                      </View>
                      <View style={styles.requirement}>
                        <View
                          style={[
                            styles.requirementDot,
                            form.password && !passwordValidation.notNumeric && styles.requirementDotError,
                          ]}
                        />
                        <Text
                          style={[
                            styles.requirementText,
                            form.password && !passwordValidation.notNumeric && styles.requirementTextError,
                          ]}
                        >
                          Not be entirely numeric
                        </Text>
                      </View>
                    </View>

                    {errors.password && !generalError && (
                      <Text style={styles.fieldError}>{errors.password.join(' ')}</Text>
                    )}
                  </View>

                  <PrimaryButton
                    onPress={handleSignUp}
                    loading={isLoading}
                    disabled={
                      (!passwordValidation.lengthValid && form.password.length > 0) ||
                      (!passwordValidation.notNumeric && form.password.length > 0)
                    }
                    fullWidth
                    style={styles.signUpButton}
                  >
                    Continue
                  </PrimaryButton>
                </>
              )}
            </View>

            {!isAuthenticated && (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={styles.signInSection}>
                  <Text style={styles.signInText}>
                    Already have an account?{' '}
                    <Text style={styles.signInLink} onPress={() => !isLoading && navigation.navigate('SignIn')}>
                      Sign In
                    </Text>
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GradientBackground>
  );
}
