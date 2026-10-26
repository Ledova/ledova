import { Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BuildingsIcon } from 'phosphor-react-native';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import { WEB_APP_URL } from '../../../config/publicLinks';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useSignOut } from '../../../hooks/useSignOut';

export function CompanyOnWebScreen() {
  const theme = useAppTheme();
  const { signOut, signingOut } = useSignOut();
  const styles = useThemedStyles((theme) => ({
    container: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    card: {
      backgroundColor: theme.colors.surface.raised,
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    title: {
      fontSize: theme.fontSize.xl,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
    },
    text: {
      fontSize: theme.fontSize.base,
      lineHeight: 22,
      color: theme.colors.text.body,
    },
    signOut: {
      alignSelf: 'center',
      paddingVertical: theme.spacing.sm,
    },
    signOutText: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.interactive.active,
    },
  }));
  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <View style={styles.card}>
          <BuildingsIcon size={theme.icon.sizes.lg} color={theme.colors.text.muted} weight="regular" />
          <Text accessibilityRole="header" style={styles.title}>
            Your company is managed on the web
          </Text>
          <Text style={styles.text}>
            Registering and activating a company, and running its share register, happen in Ledova on the web. Sign in
            there with this account to continue.
          </Text>
          <Text style={styles.text}>This app is for shareholders: their shares, awards, documents and details.</Text>
          <PrimaryButton onPress={() => void Linking.openURL(WEB_APP_URL)}>Open Ledova on the web</PrimaryButton>
          <Pressable
            accessibilityRole="button"
            style={styles.signOut}
            disabled={signingOut}
            onPress={() => void signOut()}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </GradientBackground>
  );
}
