import { Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@ledova/shared';
import { useThemedStyles } from '../../contexts';
import { useSignOut } from '../../hooks/useSignOut';

export function SignOutLink() {
  const { isAuthenticated } = useAuth();
  const { signOut, signingOut } = useSignOut();
  const styles = useThemedStyles((theme) => ({
    bar: {
      alignItems: 'flex-end' as const,
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
    },
    label: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.secondary,
    },
  }));

  if (!isAuthenticated) return null;

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: signingOut }}
        disabled={signingOut}
        hitSlop={12}
        onPress={() => void signOut()}
      >
        <Text style={styles.label}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </TouchableOpacity>
    </View>
  );
}
