import { Text, View } from 'react-native';
import {
  formatShareCount,
  hasValidRegisterAwardTotals,
  REGISTER_AWARD_COPY as COPY,
  shareCount,
  type OwnMemberRecord,
} from '@ledova/shared';
import { useThemedStyles } from '../../contexts';

type Award = OwnMemberRecord['awards'][number];

function useStyles() {
  return useThemedStyles((theme) => ({
    status: { gap: theme.spacing.smd },
    muted: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    note: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 18, color: theme.colors.text.muted },
    bar: {
      flexDirection: 'row' as const,
      height: 12,
      borderRadius: 6,
      overflow: 'hidden' as const,
      backgroundColor: theme.colors.surface.tertiary,
    },
    part: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.sm },
    swatch: { width: 10, height: 10, borderRadius: 2 },
    label: { flex: 1, fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    quantity: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    unvested: { backgroundColor: theme.colors.text.muted, opacity: 0.35 },
    available: { backgroundColor: theme.colors.brand.mid, opacity: 0.45 },
    issued: { backgroundColor: theme.colors.brand.mid },
    ended: { backgroundColor: theme.colors.text.muted, opacity: 0.7 },
  }));
}

export function AwardStatus({ award }: { award: Award }) {
  const styles = useStyles();
  if (!hasValidRegisterAwardTotals(award))
    return (
      <Text accessibilityRole="alert" style={styles.muted}>
        Award quantities are unavailable. Refresh the current record.
      </Text>
    );
  const promised = BigInt(award.shares);
  const parts = [
    { label: 'Unvested', quantity: BigInt(award.unvestedRemainingShares), look: styles.unvested },
    { label: 'Vested, awaiting issue', quantity: BigInt(award.availableShares), look: styles.available },
    { label: 'Issued from award', quantity: BigInt(award.issuedShares), look: styles.issued },
    { label: COPY.ENDED_UNVESTED, quantity: BigInt(award.endedUnvestedShares), look: styles.ended },
    { label: COPY.ENDED_VESTED, quantity: BigInt(award.endedVestedShares), look: styles.ended },
  ];
  return (
    <View style={styles.status}>
      <Text style={styles.muted}>{shareCount(award.shares)} promised</Text>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Award status: ${parts
          .map((part) => `${formatShareCount(String(part.quantity))} ${part.label.toLowerCase()}`)
          .join(', ')}. ${shareCount(award.shares)} promised.`}
        style={styles.bar}
      >
        {parts.map((part) => (
          <View
            key={part.label}
            style={[part.look, { width: `${Number((part.quantity * 10000n) / promised) / 100}%` }]}
          />
        ))}
      </View>
      {parts
        .filter((part) => part.quantity > 0n)
        .map((part) => (
          <View
            key={part.label}
            accessible
            accessibilityLabel={`${part.label}: ${shareCount(String(part.quantity))}`}
            style={styles.part}
          >
            <View style={[styles.swatch, part.look]} />
            <Text style={styles.label}>{part.label}</Text>
            <Text style={styles.quantity}>{shareCount(String(part.quantity))}</Text>
          </View>
        ))}
      <Text style={styles.note}>Issued award shares are already included in the holding.</Text>
    </View>
  );
}
