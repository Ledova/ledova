import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientBackground } from '../../../components/GradientBackground';
import { PrimaryButton } from '../../../components/buttons';
import { useThemedStyles } from '../../../contexts';
import { useSignOut } from '../../../hooks/useSignOut';

export function ShareholdersOnlyScreen() {
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
      fontFamily: theme.fontFamily.display,
      fontSize: theme.fontSize.xl,
      color: theme.colors.text.primary,
    },
    text: {
      fontSize: theme.fontSize.base,
      lineHeight: 22,
      color: theme.colors.text.body,
    },
  }));
  return (
    <GradientBackground>
      <SafeAreaView style={styles.container}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            This app is for shareholders
          </Text>
          <Text style={styles.text}>
            Companies are registered and run on the web, not in this app. Here, people see the shares, awards and
            documents that companies record for them.
          </Text>
          <PrimaryButton disabled={signingOut} onPress={() => void signOut()}>
            Sign out
          </PrimaryButton>
        </View>
      </SafeAreaView>
    </GradientBackground>
  );
}
