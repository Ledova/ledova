import { Text, View } from 'react-native';
import { CheckCircleIcon, ClockIcon, CloudIcon, HardDrivesIcon, WalletIcon } from 'phosphor-react-native';
import {
  WALLET_SIGNING_PREFERENCE,
  WALLET_VERIFICATION_STATUS,
  formatCryptoBalance,
  formatSyncAge,
  formatWalletAddressShort,
  getNativeAssetSymbol,
  getWalletSigningPreferenceLabel,
  useCurrency,
} from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { Row, Rows } from '../Ledger';
import { useAppTheme, useThemedStyles } from '../../contexts';

export function WalletSummary({ wallet, compact = false }: { wallet: Wallet; compact?: boolean }) {
  const theme = useAppTheme();
  const { formatDisplayCurrency } = useCurrency();
  const styles = useThemedStyles((theme) => ({
    summary: { gap: theme.spacing.xs },
    heading: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: theme.spacing.sm },
    badge: { marginTop: 1 },
    dot: { position: 'absolute' as const, bottom: -2, right: -2 },
    titles: { flex: 1, gap: theme.spacing.xs },
    name: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    meta: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.smd,
    },
    age: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.xs },
    ageText: { fontFamily: theme.fontFamily.regular, fontSize: theme.fontSize.xs, color: theme.colors.text.subtle },
  }));
  const verified = wallet.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED;
  const SigningIcon = wallet.signingPreference === WALLET_SIGNING_PREFERENCE.HARDWARE ? HardDrivesIcon : CloudIcon;
  const syncAge = formatSyncAge(wallet.lastSyncedAt);

  return (
    <View style={styles.summary}>
      <View style={styles.heading}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={verified ? 'Wallet address verified' : 'Wallet address verification pending'}
          style={styles.badge}
        >
          <WalletIcon
            size={theme.icon.sizes.md}
            color={verified ? theme.colors.status.success.icon : theme.colors.text.muted}
            weight={theme.icon.weights.regular}
          />
          {verified ? (
            <CheckCircleIcon
              size={theme.icon.sizes.xs}
              color={theme.colors.status.success.icon}
              weight="fill"
              style={styles.dot}
            />
          ) : (
            <ClockIcon
              size={theme.icon.sizes.xs}
              color={theme.colors.status.warning.icon}
              weight="fill"
              style={styles.dot}
            />
          )}
        </View>
        <View style={styles.titles}>
          <Text style={styles.name}>
            {wallet.name || (compact ? formatWalletAddressShort(wallet.address) : 'Unnamed wallet')}
          </Text>
          {(!!wallet.signingPreference || !!syncAge) && (
            <View style={styles.meta}>
              {!!wallet.signingPreference && (
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={getWalletSigningPreferenceLabel(wallet.signingPreference)}
                >
                  <SigningIcon size={theme.icon.sizes.xs} color={theme.colors.text.secondary} weight="bold" />
                </View>
              )}
              {!!syncAge && (
                <View style={styles.age}>
                  <ClockIcon size={theme.icon.sizes.xs} color={theme.colors.text.subtle} weight="regular" />
                  <Text style={styles.ageText}>{syncAge}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
      <Rows>
        {!compact && <Row label="Address">{wallet.address}</Row>}
        <Row label="Balance">{formatCryptoBalance(wallet.nativeBalance, getNativeAssetSymbol(wallet.chain))}</Row>
        <Row label="Estimated value">{formatDisplayCurrency(Number(wallet.marketValue))}</Row>
      </Rows>
    </View>
  );
}
