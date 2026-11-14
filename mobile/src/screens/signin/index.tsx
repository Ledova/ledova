import { useCallback, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, NavigationProp, useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { GradientBackground } from '../../components/GradientBackground';
import { PrimaryButton } from '../../components/buttons';
import { useSignIn } from './useSignIn';
import { useAppLock, useAppTheme, useThemedStyles } from '../../contexts';
import { LockIcon, EnvelopeSimpleIcon, WarningCircleIcon, ScanSmileyIcon, KeyIcon } from 'phosphor-react-native';
import { layout } from '../../styles';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { ScreenHeader } from '../../components/header';
import { PasswordToggle } from '../../components/Input';
import { Field } from '../../components/register/RegisterFields';

export function SignInScreen() {
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
    signInButton: {
      marginTop: theme.spacing.md,
      shadowColor: theme.colors.interactive.active,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 4,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
    },
    signInButtonText: {
      color: theme.colors.utility.white,
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.semibold,
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
    signUpSection: {
      alignItems: 'center',
    },
    signUpText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.subtle,
      textAlign: 'center',
    },
    getStartedLink: {
      color: theme.colors.interactive.active,
      fontWeight: theme.fontWeight.semibold,
    },
  }));
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const {
    biometricsAvailable,
    hasBiometricLogin,
    biometricType,
    biometricLoginEnabled,
    enableBiometricLogin,
    readBiometricRefreshToken,
    reloadBiometricLogin,
  } = useAppLock();
  const [biometricLoading, setBiometricLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      queryClient.clear();
      reloadBiometricLogin();
    }, [queryClient, reloadBiometricLogin]),
  );

  const {
    form,
    errors,
    generalError,
    isLoading,
    showPassword,
    setFieldValue,
    togglePassword,
    handleSubmit,
    loginWithRefreshToken,
    setGeneralError,
  } = useSignIn();

  const navigateToMainApp = useCallback(() => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainApp' }],
    });
  }, [navigation]);

  const handleSignIn = async () => {
    const hasCredentialsEntered = form.email.trim() || form.password;
    if (showBiometricLogin && !hasCredentialsEntered) {
      await handleBiometricLogin();
      return;
    }

    await handleSubmit(async () => {
      if (biometricsAvailable && !biometricLoginEnabled) {
        Alert.alert(
          `Enable ${biometricType} sign-in?`,
          `Would you like to use ${biometricType} to sign in next time?`,
          [
            {
              text: 'Not now',
              style: 'cancel',
              onPress: navigateToMainApp,
            },
            {
              text: 'Enable',
              onPress: async () => {
                await enableBiometricLogin();
                navigateToMainApp();
              },
            },
          ],
        );
      } else {
        navigateToMainApp();
      }
    });
  };

  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    try {
      const result = await readBiometricRefreshToken();
      if (result.token) {
        const signedIn = await loginWithRefreshToken(result.token, navigateToMainApp);
        if (!signedIn) {
          await reloadBiometricLogin();
        }
      } else if (result.missing) {
        setGeneralError(`${biometricType} sign in needs to be set up again. Please sign in with your password.`);
      }
    } finally {
      setBiometricLoading(false);
    }
  };

  const showBiometricLogin = biometricsAvailable && hasBiometricLogin;

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <ScreenHeader
              icon={
                <LockIcon
                  size={theme.icon.sizes.md}
                  color={theme.colors.text.muted}
                  weight={theme.icon.weights.regular}
                />
              }
              title="Welcome back"
            />

            <View style={styles.formContainer}>
              {generalError && (
                <View style={styles.errorContainer}>
                  <WarningCircleIcon
                    size={theme.icon.sizes.md}
                    color={theme.colors.form.error}
                    weight={theme.icon.weights.regular}
                  />
                  <Text style={styles.errorText}>{generalError}</Text>
                </View>
              )}

              <View style={styles.fieldContainer}>
                <Field
                  filled
                  label="Email"
                  icon={<EnvelopeSimpleIcon size={theme.icon.sizes.md} color={theme.colors.text.subtle} />}
                  placeholder="your@email.com"
                  value={form.email}
                  onChange={(text) => setFieldValue('email', text)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  error={generalError ? null : errors.email?.join(' ')}
                />
              </View>

              <View style={styles.fieldContainer}>
                <Field
                  filled
                  label="Password"
                  icon={<LockIcon size={theme.icon.sizes.md} color={theme.colors.text.subtle} />}
                  trailing={<PasswordToggle shown={showPassword} disabled={isLoading} onPress={togglePassword} />}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(text) => setFieldValue('password', text)}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!isLoading}
                  error={generalError ? null : errors.password?.join(' ')}
                />
              </View>

              <PrimaryButton
                accessibilityLabel="Sign in"
                onPress={handleSignIn}
                loading={isLoading || biometricLoading}
                fullWidth
                style={styles.signInButton}
              >
                <View style={styles.buttonContent}>
                  {showBiometricLogin ? (
                    <ScanSmileyIcon size={22} color={theme.colors.utility.white} weight="regular" />
                  ) : (
                    <KeyIcon size={22} color={theme.colors.utility.white} weight="regular" />
                  )}
                  <Text style={styles.signInButtonText}>Sign in</Text>
                </View>
              </PrimaryButton>
            </View>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.signUpSection}>
              <Text style={styles.signUpText}>
                Don&apos;t have an account?{' '}
                <Text style={styles.getStartedLink} onPress={() => !isLoading && navigation.navigate('SignUp')}>
                  Get started
                </Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GradientBackground>
  );
}
