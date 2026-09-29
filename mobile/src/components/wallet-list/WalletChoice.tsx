import { ActivityIndicator, Pressable, View } from 'react-native';
import type { Wallet } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { WalletSummary } from './WalletSummary';

export function WalletChoice({
  wallet,
  onChoose,
  disabled = false,
  busy = false,
}: {
  wallet: Wallet;
  onChoose: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    choice: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.smd,
    },
    summary: { flex: 1 },
    held: { opacity: 0.5 },
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onChoose}
      style={[styles.choice, disabled && styles.held]}
    >
      <View style={styles.summary}>
        <WalletSummary wallet={wallet} compact />
      </View>
      {busy && <ActivityIndicator size="small" color={theme.colors.interactive.active} />}
    </Pressable>
  );
}
