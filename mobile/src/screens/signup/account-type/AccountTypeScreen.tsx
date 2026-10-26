import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { WarningCircleIcon } from 'phosphor-react-native';
import { useSignupAccountType } from '@ledova/shared';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { useAppTheme, useThemedStyles } from '../../../contexts';

export function AccountTypeScreen() {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
    },
    content: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
      justifyContent: 'center',
      gap: theme.spacing.lg,
    },
    header: {
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    title: {
      fontFamily: theme.fontFamily.display,
      fontSize: theme.fontSize.xl,
      color: theme.colors.text.primary,
    },
    subtitle: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      textAlign: 'center',
    },
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.error.default + '1A',
      borderWidth: 1,
      borderColor: theme.colors.form.borderError,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
    },
    errorText: {
      color: theme.colors.form.error,
      fontSize: theme.fontSize.sm,
      marginLeft: theme.spacing.sm,
      flex: 1,
    },
    footer: {
      alignItems: 'center',
    },
    backLink: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.interactive.active,
    },
  }));
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { account, isSubmitting, error, chooseRole } = useSignupAccountType();

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              Welcome to Ledova
            </Text>
            <Text style={styles.subtitle}>See the shares, awards and documents that companies record for you.</Text>
          </View>

          {error ? (
            <View style={styles.errorContainer}>
              <WarningCircleIcon
                size={theme.icon.sizes.md}
                color={theme.colors.status.error.icon}
                weight={theme.icon.weights.regular}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            loading={isSubmitting}
            disabled={isSubmitting || !account}
            onPress={() => chooseRole('investor', () => navigation.navigate('PreScreening'))}
          >
            Continue
          </PrimaryButton>

          <View style={styles.footer}>
            <TouchableOpacity onPress={() => navigation.navigate('SignUp')} disabled={isSubmitting}>
              <Text style={styles.backLink}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </GradientBackground>
  );
}
