import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserIcon, BuildingsIcon } from 'phosphor-react-native';
import { CACHE_TIMING, describeFailure, getUserAccount, setAccountRole } from '@ledova/shared';
import { GradientBackground } from '../../../components/GradientBackground';
import { apiClient } from '../../../services/apiClient';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { useAppTheme, useThemedStyles } from '../../../contexts';

type AccountRole = 'investor' | 'company';

interface AccountTypeOption {
  role: AccountRole;
  title: string;
  description: string;
  icon: typeof UserIcon;
}

const ACCOUNT_TYPES: AccountTypeOption[] = [
  {
    role: 'investor',
    title: 'Individual Investor',
    description: 'Invest in tokenized company shares and manage your digital assets from one portfolio.',
    icon: UserIcon,
  },
  {
    role: 'company',
    title: 'Company Representative',
    description: 'Register your company to issue tokenized shares and manage shareholders on-chain.',
    icon: BuildingsIcon,
  },
];

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
    },
    header: {
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
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
    },
    options: {
      gap: theme.spacing.md,
    },
    optionCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: theme.colors.surface.raised,
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    iconContainer: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.surface.tertiary,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionText: {
      flex: 1,
    },
    optionTitle: {
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginBottom: 4,
    },
    optionDescription: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      lineHeight: 20,
    },
    footer: {
      alignItems: 'center',
      marginTop: theme.spacing.xl,
    },
    backLink: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.interactive.active,
    },
  }));
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: accountResponse } = useQuery({
    queryKey: ['userAccount'],
    queryFn: () => getUserAccount(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const account = accountResponse?.data ?? null;

  const updateRoleMutation = useMutation({
    mutationFn: (role: AccountRole) => setAccountRole(apiClient, account!.uuid, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userAccount'] });
      queryClient.invalidateQueries({ queryKey: ['userPreferences'] });
    },
  });

  const handleSelect = async (role: AccountRole) => {
    if (!account || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateRoleMutation.mutateAsync(role);
      if (role === 'investor') {
        navigation.navigate('PreScreening');
      } else {
        navigation.navigate('IdentityVerification');
      }
    } catch (error) {
      console.error(`Failed to update account role: ${describeFailure(error)}`);
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    navigation.navigate('EmailConfirmation');
  };

  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Choose Account Type</Text>
            <Text style={styles.subtitle}>How will you be using Ledova?</Text>
          </View>

          <View style={styles.options}>
            {ACCOUNT_TYPES.map((option) => {
              const Icon = option.icon;
              return (
                <TouchableOpacity
                  key={option.role}
                  style={styles.optionCard}
                  onPress={() => handleSelect(option.role)}
                  disabled={isSubmitting || !account}
                  activeOpacity={0.7}
                >
                  {isSubmitting ? (
                    <View style={styles.iconContainer}>
                      <ActivityIndicator size="small" color={theme.colors.text.muted} />
                    </View>
                  ) : (
                    <View style={styles.iconContainer}>
                      <Icon size={theme.icon.sizes.lg} color={theme.colors.text.muted} weight="regular" />
                    </View>
                  )}
                  <View style={styles.optionText}>
                    <Text style={styles.optionTitle}>{option.title}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity onPress={handleBack} disabled={isSubmitting}>
              <Text style={styles.backLink}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </GradientBackground>
  );
}
