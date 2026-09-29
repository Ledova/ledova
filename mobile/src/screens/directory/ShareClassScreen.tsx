import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatDate, formatMoney, formatShareCount, useDirectoryToken, useSubscribableWallets } from '@ledova/shared';
import type { DirectoryStackParamList } from '../../navigation/DirectoryStackNavigator';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { DirectoryPage, useDirectoryStyles } from './DirectoryPage';
import { ApplyForm, type ApplicationDraft } from '../applications/ApplyForm';
import { useCreateSubscription } from '../applications/useApplications';
import { getSessionEpoch } from '../../services/sessionScope';

export function ShareClassScreen() {
  const { params } = useRoute<RouteProp<DirectoryStackParamList, 'DirectoryClass'>>();
  const navigation = useNavigation<NativeStackNavigationProp<DirectoryStackParamList>>();
  const styles = useDirectoryStyles();
  const {
    token,
    operator,
    isLoading,
    hasError,
    notFound,
    isRefreshing,
    retry,
    operatorLoading,
    operatorFailed,
    operatorRefreshing,
    retryOperator,
  } = useDirectoryToken(params.uuid);
  const offering = token?.openOffering;
  const [draft, setDraft] = useState<(ApplicationDraft & { offering: string }) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wallets = useSubscribableWallets(Boolean(offering) && !hasError && !notFound);
  const create = useCreateSubscription((uuid) => {
    if (mounted.current && navigation.isFocused())
      navigation.getParent()?.navigate('Applications', { screen: 'ApplicationDetail', params: { uuid } });
  });
  return (
    <DirectoryPage
      title="Share class"
      lede={!hasError && token && !notFound ? token.company.displayName : undefined}
      actions={
        <Action
          disabled={create.isPending}
          label="Back to Directory"
          onPress={() => navigation.navigate('DirectoryMain')}
        />
      }
      loading={isLoading}
      refreshing={isRefreshing || wallets.isRefreshing}
      refresh={() => {
        if (!create.isPending) {
          void retry();
          if (offering) void wallets.retry();
        }
      }}
    >
      {hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.message}>
            This share class could not be loaded. Try again before continuing.
          </Text>
          <Action label="Try again" onPress={() => void retry()} disabled={isRefreshing} />
        </View>
      ) : !token || notFound ? (
        <Section title="Share class not available">
          <Text style={styles.help}>
            This share class is not available to you in the directory. It may have closed or your investor status may
            need updating.
          </Text>
        </Section>
      ) : (
        <>
          <Section title={token.name}>
            <Rows>
              <Row label="Symbol">{token.symbol}</Row>
              <Row label="Authorised shares">{formatShareCount(token.totalSupply)}</Row>
              <Row label="Shares issued">
                {Number.isSafeInteger(token.issuedShares) && token.issuedShares >= 0
                  ? formatShareCount(String(token.issuedShares))
                  : 'Unavailable'}
              </Row>
              {token.company.industry && <Row label="Industry">{token.company.industry}</Row>}
              {[token.company.city, token.company.state].some(Boolean) && (
                <Row label="Location">{[token.company.city, token.company.state].filter(Boolean).join(', ')}</Row>
              )}
            </Rows>
          </Section>
          <Section title="Current offering">
            <Text style={styles.message}>{offering ? 'Open for applications' : 'No offering open'}</Text>
            {offering ? (
              <Rows>
                <Row label="Price per share">{formatMoney(offering.pricePerShare, offering.priceCurrency)}</Row>
                <Row label="Opened">{formatDate(offering.opensAt)}</Row>
                <Row label="Closes">{offering.closesAt ? formatDate(offering.closesAt) : 'No closing date'}</Row>
              </Rows>
            ) : (
              <Text style={styles.help}>
                An offering will appear here when the operator has approved it and its opening time has arrived.
              </Text>
            )}
          </Section>
          {offering &&
            (wallets.isLoading ? (
              <Text style={styles.help}>Loading your receiving wallets…</Text>
            ) : wallets.hasError ? (
              <View style={styles.group}>
                <Text accessibilityRole="alert" style={styles.message}>
                  Your receiving wallets could not be loaded. Try again before applying.
                </Text>
                <Action
                  label="Try wallets again"
                  onPress={() => void wallets.retry()}
                  disabled={wallets.isRefreshing || create.isPending}
                />
              </View>
            ) : (
              <ApplyForm
                offering={offering}
                draft={draft?.offering === offering.uuid ? draft : { quantity: '', wallet: null }}
                onDraftChange={(value) => setDraft({ ...value, offering: offering.uuid })}
                wallets={wallets.wallets}
                busy={create.isPending}
                blocked={isRefreshing || wallets.isRefreshing}
                error={create.variables?.input.offering === offering.uuid ? create.error : null}
                onCreate={(input) => {
                  if (!create.isPending && !isRefreshing && !wallets.isRefreshing && !wallets.hasError)
                    create.mutate({ input: { ...input, offering: offering.uuid }, epoch: getSessionEpoch() });
                }}
                openWallets={() => navigation.getParent()?.navigate('Wallets', { screen: 'WalletsList' })}
              />
            ))}
          <Section title="Payments">
            {operatorLoading ? (
              <Text style={styles.help}>Loading operator details…</Text>
            ) : operatorFailed ? (
              <View style={styles.group}>
                <Text accessibilityRole="alert" style={styles.message}>
                  Operator details could not be loaded.
                </Text>
                <Action
                  label="Try operator details again"
                  onPress={() => void retryOperator()}
                  disabled={operatorRefreshing}
                />
              </View>
            ) : (
              <Text style={styles.help}>
                {operator?.name ?? 'The operator'} reviews your application. After it is accepted, open the application
                for the exact amount and payment reference. Creating a draft does not send a payment.
              </Text>
            )}
          </Section>
        </>
      )}
    </DirectoryPage>
  );
}
