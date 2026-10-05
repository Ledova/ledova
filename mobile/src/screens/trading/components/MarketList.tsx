import { ActivityIndicator, Text, View } from 'react-native';
import { DIRECTORY_COPY, formatShareCount, marketAmount, type ShareToken } from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../../components/Ledger';
import { useMarketStyles } from '../styles';

interface MarketListProps {
  tokens: ShareToken[];
  selectedTokenUuid: string | null;
  onSelectToken: (uuid: string) => void;
  isLoading: boolean;
  isReady: boolean;
  error?: unknown;
  onRetry?: () => void;
  disabled?: boolean;
}

export function MarketList({
  tokens,
  selectedTokenUuid,
  onSelectToken,
  isLoading,
  isReady,
  error,
  onRetry,
  disabled,
}: MarketListProps) {
  const styles = useMarketStyles();
  return (
    <Section title="Share classes">
      <Text style={styles.muted}>
        Select a share class to see For sale and Wanted. Orders match automatically. Buyers fund their payment wallet
        before placing an offer.
      </Text>
      {error ? (
        <View style={styles.fields}>
          <Text accessibilityRole="alert" style={styles.error}>
            Share classes could not be loaded.
          </Text>
          <Action label="Retry share classes" onPress={() => onRetry?.()} />
        </View>
      ) : isLoading ? (
        <ActivityIndicator accessibilityLabel="Loading share classes" />
      ) : tokens.length === 0 ? (
        <View style={styles.fields}>
          <Text style={styles.text}>
            {isReady ? DIRECTORY_COPY.MARKET_EMPTY_TITLE : DIRECTORY_COPY.INELIGIBLE_TITLE}
          </Text>
          <Text style={styles.muted}>
            {isReady ? DIRECTORY_COPY.MARKET_EMPTY_BODY : DIRECTORY_COPY.MARKET_INELIGIBLE_BODY}
          </Text>
        </View>
      ) : (
        <Rows>
          {tokens.map((token) => (
            <View key={token.uuid} style={styles.classRow}>
              <Action
                label={`${token.companyName || token.name} · ${token.symbol}`}
                primary={selectedTokenUuid === token.uuid}
                disabled={disabled}
                onPress={() => onSelectToken(token.uuid)}
              />
              <Rows>
                <Row label="Last trade">{token.lastPrice ? marketAmount(token.lastPrice) : 'Not recorded'}</Row>
                <Row label="Authorised shares">{formatShareCount(token.totalSupply || '0')}</Row>
              </Rows>
            </View>
          ))}
        </Rows>
      )}
    </Section>
  );
}
