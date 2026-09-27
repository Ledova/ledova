import { useState, type ReactNode } from 'react';
import { Text, View, ScrollView, RefreshControl, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  formatDate,
  formatShareCount,
  getBlockExplorerAddressUrl,
  getBlockExplorerTxUrl,
  getErrorMessage,
  REGISTER_COPY,
} from '@ledova/shared';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { Section, Row, Action } from '../../components/Ledger';
import { ClassRegister } from '../company-register/ClassRegister';
import { useCompanyStyles } from '../company-register/styles';
import { useTokenDetail } from './useTokenDetail';
import { IssueSharesForm, RaiseSharesForm } from './ShareRequestForms';

type Props = NativeStackScreenProps<CompanyStackParamList, 'TokenDetail'>;

function ReadResult({
  query,
  label,
  children,
}: {
  query: { isPending: boolean; isError: boolean; isFetching: boolean; refetch: () => Promise<unknown> };
  label: string;
  children: ReactNode;
}) {
  const styles = useCompanyStyles();
  if (query.isPending) return <Text style={styles.muted}>Loading {label}…</Text>;
  if (query.isError)
    return (
      <View style={styles.group}>
        <Text accessibilityRole="alert" style={styles.error}>
          We couldn’t load {label}.
        </Text>
        <Action label={`Retry ${label}`} disabled={query.isFetching} onPress={() => void query.refetch()} />
      </View>
    );
  return <>{children}</>;
}

export function TokenDetailScreen({ route }: Props) {
  return <ShareClass key={route.params.uuid} uuid={route.params.uuid} />;
}

function ShareClass({ uuid }: { uuid: string }) {
  const styles = useCompanyStyles();
  const data = useTokenDetail(uuid);
  const [form, setForm] = useState<'issue' | 'raise' | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const token = data.token.data;
  const forms = token && (
    <>
      {form === 'issue' && (
        <IssueSharesForm token={token} classRead={data.token} onClose={() => setForm(null)} onSuccess={data.refresh} />
      )}
      {form === 'raise' && (
        <RaiseSharesForm token={token} classRead={data.token} onClose={() => setForm(null)} onSuccess={data.refresh} />
      )}
    </>
  );
  const openLink = async (url: string) => {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('The explorer could not be opened. Try again.');
    }
  };
  const copyAddress = async (address: string) => {
    setLinkError(null);
    try {
      await Clipboard.setStringAsync(address);
    } catch {
      setLinkError('The address could not be copied. Try again.');
    }
  };
  if (!data.access.allowed)
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.content}>
        <Text style={styles.muted}>
          {data.access.isLoading
            ? 'Loading your company access…'
            : 'Verify your company access before opening a share class.'}
        </Text>
        {data.access.isError && <Action label="Retry company access" onPress={() => void data.access.refetch()} />}
      </ScrollView>
    );
  if (data.token.isPending)
    return (
      <View style={[styles.page, styles.content]}>
        <Text style={styles.muted}>Loading share class…</Text>
      </View>
    );
  if (data.token.isError || !token)
    return (
      <>
        <ScrollView style={styles.page} contentContainerStyle={styles.content}>
          <Text accessibilityRole="alert" style={styles.error}>
            We couldn’t load this share class.
          </Text>
          <Action
            label="Retry share class"
            disabled={data.token.isFetching}
            onPress={() => void data.token.refetch()}
          />
        </ScrollView>
        {forms}
      </>
    );
  const contractUrl =
    token.chain && token.contractAddress ? getBlockExplorerAddressUrl(token.chain, token.contractAddress) : '';
  const transactionUrl =
    token.chain && token.deploymentTxHash ? getBlockExplorerTxUrl(token.chain, token.deploymentTxHash) : '';
  return (
    <>
      <ScrollView
        testID="share-class-screen"
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={data.token.isFetching} onRefresh={() => void data.refresh()} />}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {token.name}
        </Text>
        <Text style={styles.muted}>
          {token.companyName} · {token.symbol}
        </Text>
        <Section title="Class details">
          <View>
            <Row label="Class state">{token.statusDisplay}</Row>
            <Row label="Share type">{token.tokenTypeDisplay}</Row>
            <Row label="Authorised shares">{formatShareCount(token.totalSupply)}</Row>
            <Row label="Issued shares">
              {data.register.isPending
                ? 'Loading…'
                : data.register.isError
                  ? 'Unavailable'
                  : data.register.data?.issuedSupply == null
                    ? 'Not recorded'
                    : formatShareCount(data.register.data.issuedSupply)}
            </Row>
            <Row label="Transferable">{token.isTransferable ? 'Yes' : 'No'}</Row>
            <Row label="Divisible">{token.isDivisible ? 'Yes' : 'No'}</Row>
            <Row label="Decimals">{token.decimals}</Row>
            {token.deployedAt && <Row label="Deployed">{formatDate(token.deployedAt)}</Row>}
          </View>
          {token.contractAddress && (
            <>
              <Text selectable style={styles.text}>
                {token.contractAddress}
              </Text>
              <Action label="Copy contract address" onPress={() => void copyAddress(token.contractAddress!)} />
              {contractUrl !== '' && <Action label="View contract" onPress={() => void openLink(contractUrl)} />}
            </>
          )}
          {transactionUrl !== '' && (
            <Action label="View deployment transaction" onPress={() => void openLink(transactionUrl)} />
          )}
          {linkError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {linkError}
            </Text>
          )}
          {token.status === 'draft' && (
            <ReadResult query={data.company} label="company state">
              <Text style={styles.muted}>The company must be active before this class can be deployed.</Text>
              <Action
                label="Deploy class"
                disabled={
                  data.token.isFetching ||
                  data.company.isFetching ||
                  data.company.data?.status !== 'active' ||
                  data.deploy.isPending
                }
                onPress={() => data.deploy.mutate()}
              />
            </ReadResult>
          )}
          {data.deploy.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {getErrorMessage(data.deploy.error, 'Deployment could not be started. Try again.')}
            </Text>
          )}
          {token.status === 'deployed' && (
            <>
              <Action label="Request issuance" onPress={() => setForm('issue')} />
              <Action label="Raise authorised shares" onPress={() => setForm('raise')} />
            </>
          )}
        </Section>
        <Section title="Register of members">
          <Text style={styles.muted}>{REGISTER_COPY.PRIVACY_NOTE}</Text>
          <Action
            label={REGISTER_COPY.DOWNLOAD}
            disabled={
              data.register.isPending ||
              data.register.isError ||
              !data.register.data?.initialized ||
              data.download.isPending
            }
            onPress={() => data.download.mutate()}
          />
          {data.download.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {REGISTER_COPY.DOWNLOAD_FAILED}
            </Text>
          )}
          <ReadResult query={data.register} label="register">
            {data.register.data && <ClassRegister register={data.register.data} />}
          </ReadResult>
        </Section>
        <Section title="Issuance requests">
          <ReadResult query={data.requests} label="issuance requests">
            {data.requests.data?.length === 0 ? (
              <Text style={styles.muted}>No issuance requests yet.</Text>
            ) : (
              data.requests.data?.map((request) => (
                <View key={request.uuid} style={styles.entry}>
                  <Text style={styles.text}>
                    {formatShareCount(String(request.amount))} {request.tokenSymbol} to {request.recipientAddress}
                  </Text>
                  <Text style={styles.muted}>{request.reason || request.issuanceTypeDisplay}</Text>
                  <Text style={styles.text}>{request.statusDisplay}</Text>
                  <Text style={styles.muted}>{formatDate(request.createdAt)}</Text>
                  {request.rejectionReason && <Text style={styles.muted}>{request.rejectionReason}</Text>}
                  {request.executionNotes && (
                    <>
                      <Action
                        label={history.includes(request.uuid) ? 'Hide execution history' : 'Execution history'}
                        accessibilityLabel={`Execution history ${request.uuid}`}
                        onPress={() =>
                          setHistory((values) =>
                            values.includes(request.uuid)
                              ? values.filter((value) => value !== request.uuid)
                              : [...values, request.uuid],
                          )
                        }
                      />
                      {history.includes(request.uuid) && <Text style={styles.muted}>{request.executionNotes}</Text>}
                    </>
                  )}
                </View>
              ))
            )}
          </ReadResult>
        </Section>
        <Section title="Authorised share requests">
          <Text style={styles.muted}>
            Raising the cap requires staff review and execution. It does not issue shares.
          </Text>
          {data.submitCapital.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {getErrorMessage(data.submitCapital.error, 'The request could not be submitted. Try again.')}
            </Text>
          )}
          <ReadResult query={data.capital} label="authorised share requests">
            {data.capital.data?.length === 0 ? (
              <Text style={styles.muted}>No authorised share requests yet.</Text>
            ) : (
              data.capital.data?.map((request) => (
                <View key={request.uuid} style={styles.entry}>
                  <Text style={styles.text}>{request.purpose}</Text>
                  <Text style={styles.muted}>
                    +{formatShareCount(String(request.additionalShares))} →{' '}
                    {formatShareCount(String(request.newAuthorizedTotal))} authorised shares
                  </Text>
                  <Text style={styles.text}>{request.statusDisplay}</Text>
                  <Text style={styles.muted}>{formatDate(request.createdAt)}</Text>
                  {request.status === 'draft' && (
                    <Action
                      label="Submit for review"
                      accessibilityLabel={`Submit ${request.purpose} for review`}
                      disabled={data.capital.isFetching || data.token.isFetching || data.submitCapital.isPending}
                      onPress={() => data.submitCapital.mutate(request.uuid)}
                    />
                  )}
                </View>
              ))
            )}
          </ReadResult>
        </Section>
        <Section title="Issuances">
          <ReadResult query={data.issuances} label="issuances">
            {data.issuances.data?.length === 0 ? (
              <Text style={styles.muted}>No issuances yet.</Text>
            ) : (
              data.issuances.data?.map((issuance) => (
                <View key={issuance.uuid} style={styles.entry}>
                  <Text style={styles.text}>
                    {formatShareCount(issuance.amount)} shares to {issuance.recipientAddress}
                  </Text>
                  <Text style={styles.muted}>
                    {issuance.statusDisplay} · {formatDate(issuance.createdAt)}
                  </Text>
                  {issuance.subscriptionReference && (
                    <Text style={styles.muted}>Application {issuance.subscriptionReference}</Text>
                  )}
                </View>
              ))
            )}
          </ReadResult>
        </Section>
      </ScrollView>
      {forms}
    </>
  );
}
