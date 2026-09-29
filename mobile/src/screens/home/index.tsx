import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native';
import { CaretDownIcon, CaretRightIcon } from 'phosphor-react-native';
import { formatShareCount, getChainConfig, useShareHoldings, type ShareHoldingRow } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { HoldingWork } from './components/HoldingWork';
import { useHoldingWork } from './useHoldingWork';

function ShareHolding({ holding }: { holding: ShareHoldingRow }) {
  const [expanded, setExpanded] = useState(false);
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    row: { borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    summary: { paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.smd },
    names: { flex: 1, gap: 4 },
    company: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    name: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    quantity: { fontFamily: theme.fontFamily.regular, fontSize: 15, color: theme.colors.text.primary, marginTop: 6 },
    detail: { paddingBottom: 18, paddingLeft: 30, gap: 20 },
    chain: { gap: 10 },
    chainName: { fontFamily: theme.fontFamily.semibold, fontSize: 14, color: theme.colors.text.muted },
    wallet: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border.subtle },
    walletName: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
  }));
  const count = (quantity: string) => `${formatShareCount(quantity)} ${quantity === '1' ? 'share' : 'shares'}`;
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${holding.companyName ? `${holding.companyName}, ` : ''}${holding.name}, ${count(holding.quantity)}`}
        onPress={() => setExpanded((value) => !value)}
        style={styles.summary}
      >
        <Caret size={18} color={theme.colors.text.muted} />
        <View style={styles.names}>
          {holding.companyName && <Text style={styles.company}>{holding.companyName}</Text>}
          <Text style={styles.name}>{holding.name}</Text>
          <Text style={styles.quantity}>{count(holding.quantity)}</Text>
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.detail}>
          {holding.chains.map((chain) => (
            <View key={chain.chain} style={styles.chain}>
              <Text style={styles.chainName}>{getChainConfig(chain.chain)?.name ?? chain.chain}</Text>
              <Text style={styles.walletName}>{count(chain.quantity)}</Text>
              {chain.wallets.map((wallet) => (
                <View key={wallet.uuid} style={styles.wallet}>
                  <Text selectable style={styles.walletName}>
                    {wallet.name || wallet.address}
                  </Text>
                  <Text style={styles.quantity}>{count(wallet.quantity)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function HomeScreen() {
  const theme = useAppTheme();
  const work = useHoldingWork();
  const { data: holdings = [], isPending, isError, isFetching, refetch } = useShareHoldings();
  const styles = useThemedStyles((theme) => ({
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.muted },
    state: { gap: 14, alignItems: 'flex-start' },
    retry: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
    },
    retryText: { fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
  }));

  return (
    <Page
      title="Holdings"
      refreshControl={
        <RefreshControl
          refreshing={(isFetching && !isPending) || work.isRefreshing}
          onRefresh={() => void Promise.all([refetch(), work.refresh()])}
          tintColor={theme.colors.brand.default}
        />
      }
    >
      <Section title="Shares in your wallets">
        {isPending ? (
          <View style={styles.state}>
            <ActivityIndicator color={theme.colors.brand.default} />
            <Text style={styles.message}>Loading your holdings…</Text>
          </View>
        ) : isError ? (
          <View style={styles.state}>
            <Text accessibilityRole="alert" style={styles.message}>
              We couldn&apos;t load all your holdings.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void refetch()}
              disabled={isFetching}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : holdings.length === 0 ? (
          <Text style={styles.message}>
            None of your wallets holds shares yet. The company&apos;s register is the record of what you hold; shares
            appear here once they are in one of your wallets.
          </Text>
        ) : (
          holdings.map((holding) => <ShareHolding key={holding.assetUuid} holding={holding} />)
        )}
      </Section>
      <HoldingWork work={work} />
    </Page>
  );
}
