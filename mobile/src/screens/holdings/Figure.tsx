import { Text, View } from 'react-native';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export function Figure({ value, caption }: { value: string; caption: string }) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    figure: { gap: 2 },
    big: { fontFamily: theme.fontFamily.display, fontSize: 40, color: theme.colors.text.primary },
  }));
  return (
    <View style={look.figure}>
      <Text style={look.big}>{value}</Text>
      <Text style={styles.muted}>{caption}</Text>
    </View>
  );
}
