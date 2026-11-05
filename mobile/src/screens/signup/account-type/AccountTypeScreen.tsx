import { View, Text, TouchableOpacity, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { WarningCircleIcon, UserIcon, BuildingsIcon } from 'phosphor-react-native';
import { useSignupAccountType } from '@ledova/shared';
import { GradientBackground } from '../../../components/GradientBackground';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { useAppTheme, useThemedStyles } from '../../../contexts';

const ACCOUNT_TYPES = [
  {
    role: 'investor',
    title: 'Individual investor',
    description: 'Invest in private-company shares and track your holdings.',
    icon: UserIcon,
  },
  {
    role: 'company',
    title: 'Company representative',
    description: 'Register your company and manage its share register.',
    icon: BuildingsIcon,
  },
] as const;

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
    choices: {
      gap: theme.spacing.md,
    },
    choice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
      padding: theme.spacing.lg,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface.raised,
    },
    choiceContent: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    choiceTitle: {
      fontFamily: theme.fontFamily.display,
      fontSize: theme.fontSize.lg,
      color: theme.colors.text.primary,
    },
    choiceDescription: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
    },
    disabled: {
      opacity: 0.5,
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
              Choose account type
            </Text>
            <Text style={styles.subtitle}>How will you be using Ledova?</Text>
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

          <View style={styles.choices}>
            {ACCOUNT_TYPES.map((option) => {
              const Icon = option.icon;
              return (
                <Pressable
                  key={option.role}
                  accessibilityRole="button"
                  accessibilityLabel={option.title}
                  disabled={isSubmitting || !account}
                  style={[styles.choice, isSubmitting || !account ? styles.disabled : null]}
                  onPress={() =>
                    void chooseRole(option.role, () =>
                      navigation.navigate(option.role === 'company' ? 'UserProfile' : 'PreScreening'),
                    )
                  }
                >
                  <Icon size={theme.icon.sizes.lg} color={theme.colors.text.muted} />
                  <View style={styles.choiceContent}>
                    <Text style={styles.choiceTitle}>{option.title}</Text>
                    <Text style={styles.choiceDescription}>{option.description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

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
