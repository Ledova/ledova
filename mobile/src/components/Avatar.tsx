import { Text, View } from 'react-native';
import { useThemedStyles } from '../contexts';
import { initials } from '../screens/holdings/holdings';

export function Avatar({ name }: { name: string }) {
  const styles = useThemedStyles((theme) => ({
    avatar: {
      width: 32,
      height: 32,
      borderRadius: theme.borderRadius.md,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: theme.colors.brand.tint,
    },
    initials: { fontFamily: theme.fontFamily.medium, fontSize: 12, color: theme.colors.brand.light },
  }));
  return (
    <View style={styles.avatar} accessible={false}>
      <Text style={styles.initials}>{initials(name)}</Text>
    </View>
  );
}
