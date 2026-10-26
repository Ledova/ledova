import { Text, View } from 'react-native';
import { useThemedStyles } from '../../contexts';
import type { Certificate } from './CertificateSheet';

export function CertificatePill({ certificate, label }: { certificate: Exclude<Certificate, null>; label: string }) {
  const styles = useThemedStyles((theme) => ({
    pill: {
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 2,
    },
    ready: { backgroundColor: theme.colors.brand.tint, borderColor: theme.colors.brand.tint },
    requested: { borderColor: theme.colors.warning.default },
    request: { borderColor: theme.colors.border.default },
    other: { borderColor: theme.colors.border.subtle },
    readyText: { color: theme.colors.brand.light },
    requestedText: { color: theme.colors.status.warning.text },
    requestText: { color: theme.colors.text.primary },
    otherText: { color: theme.colors.text.muted },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 12 },
  }));
  return (
    <View style={[styles.pill, styles[certificate]]}>
      <Text style={[styles.label, styles[`${certificate}Text`]]}>{label}</Text>
    </View>
  );
}
