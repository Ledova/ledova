import { Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@ledova/shared';
import { useThemedStyles } from '../../contexts';
import { useSignOut } from '../../hooks/useSignOut';

export function SignOutLink({ disabled = false }: { disabled?: boolean }) {
  const { isAuthenticated } = useAuth();
  const { signOut, signingOut } = useSignOut();
  const styles = useThemedStyles((theme) => ({
    bar: {
      alignItems: 'flex-end' as const,
      paddingHorizontal: theme.spacing.md,
    },
    button: {
      minHeight: 44,
      justifyContent: 'center' as const,
    },
    label: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.secondary,
    },
  }));

  if (!isAuthenticated) return null;

  const unavailable = disabled || signingOut;

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: unavailable }}
        disabled={unavailable}
        hitSlop={{ left: 12, right: 12 }}
        style={styles.button}
        onPress={() => void signOut()}
      >
        <Text style={styles.label}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </TouchableOpacity>
    </View>
  );
}
