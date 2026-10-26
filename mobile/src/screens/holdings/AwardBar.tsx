import { View } from 'react-native';
import { useThemedStyles } from '../../contexts';
import { awardParts, type MemberAward } from './holdings';

export function useAwardLooks() {
  return useThemedStyles((theme) => ({
    issued: { backgroundColor: theme.colors.brand.mid },
    available: { backgroundColor: theme.colors.brand.mid, opacity: 0.45 },
    unvested: { backgroundColor: theme.colors.text.muted, opacity: 0.35 },
    ended: { backgroundColor: theme.colors.text.muted, opacity: 0.7 },
  }));
}

export function AwardBar({ award, height = 6 }: { award: MemberAward; height?: number }) {
  const looks = useAwardLooks();
  const styles = useThemedStyles((theme) => ({
    bar: {
      flexDirection: 'row' as const,
      overflow: 'hidden' as const,
      backgroundColor: theme.colors.surface.tertiary,
    },
  }));
  const parts = awardParts(award);
  if (!parts) return null;
  return (
    <View style={[styles.bar, { height, borderRadius: height / 2 }]} accessible={false}>
      {parts.map(({ part, width }) => (
        <View key={part} style={[looks[part], { width: `${width}%` }]} />
      ))}
    </View>
  );
}
