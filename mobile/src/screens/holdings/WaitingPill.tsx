import { Text, View } from 'react-native';
import { useThemedStyles } from '../../contexts';

export function WaitingPill() {
  const styles = useThemedStyles((theme) => ({
    pill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.warning.default,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 2,
    },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 12, color: theme.colors.status.warning.text },
  }));
  return (
    <View style={styles.pill}>
      <Text style={styles.label}>Waiting</Text>
    </View>
  );
}
