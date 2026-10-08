import { useEffect, useState, type ReactNode } from 'react';
import { Text, View, RefreshControl, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { formatDate, formatShareCount, getBlockExplorerAddressUrl, getBlockExplorerTxUrl } from '@ledova/shared';
import { Section, Row, Rows, Action } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { ClassRegister } from '../company-register/ClassRegister';
import { RegisterDownload } from '../company-register/RegisterDownload';
import { useCompanyStyles } from '../company-register/styles';
import { useTokenDetail } from './useTokenDetail';
import { TokenPauseControls } from './TokenPauseControls';
import { DeploymentFlow } from './DeploymentFlow';
import { CompanyIssueFlow } from './CompanyIssueFlow';
import { CompanyCapitalFlow } from './CompanyCapitalFlow';
import { CompanyPauseFlow } from './CompanyPauseFlow';

type Props = { route: { params: { uuid: string; name?: string } }; navigation?: unknown };

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
  const [linkError, setLinkError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    setHistory([]);
    setLinkError(null);
  }, [data.epoch, data.owner]);
  const token = data.token.data;
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
  const contractUrl =
    token?.chain && token.contractAddress ? getBlockExplorerAddressUrl(token.chain, token.contractAddress) : '';
  const transactionUrl =
    token?.chain && token.deploymentTxHash ? getBlockExplorerTxUrl(token.chain, token.deploymentTxHash) : '';
  return (
    <>
      <Page
        testID="share-class-screen"
        title={data.token.isSuccess && token ? token.name : 'Share class'}
        lede={data.token.isSuccess && token ? `${token.companyName} · ${token.symbol}` : undefined}
        refreshControl={<RefreshControl refreshing={data.token.isFetching} onRefresh={() => void data.refresh()} />}
      >
        {!data.owner ? (
          <Text style={styles.muted}>Verify your current account before opening a share class.</Text>
        ) : data.token.isPending ? (
          <Text style={styles.muted}>Loading share class…</Text>
        ) : data.token.isError || !token ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              We couldn’t load this share class.
            </Text>
            <Action
              label="Retry share class"
              disabled={data.token.isFetching}
              onPress={() => void data.token.refetch()}
            />
          </View>
        ) : (
          <>
            <Section title="Class details">
              <Rows>
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
              </Rows>
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
            </Section>
            {data.isOwner && (token.status === 'deployed' || token.status === 'paused') && (
              <TokenPauseControls token={token} refreshing={data.token.isFetching} />
            )}
            <Section title="Register of members">
              <RegisterDownload
                uuid={uuid}
                disabled={data.register.isPending || data.register.isError || !data.register.data?.initialized}
              />
              <ReadResult query={data.register} label="register">
                {data.register.data && <ClassRegister register={data.register.data} />}
              </ReadResult>
            </Section>
            {data.isOwner && !data.token.isFetching && (
              <>
                <Section title="Issuance requests">
                  <ReadResult query={data.requests} label="issuance requests">
                    {data.requests.data?.length === 0 ? (
                      <Text style={styles.muted}>No issuance requests yet.</Text>
                    ) : (
                      data.requests.data?.map((request) => (
                        <View key={request.uuid} style={styles.entry}>
                          <Text style={styles.text}>
                            {formatShareCount(String(request.amount))} {request.tokenSymbol} to{' '}
                            {request.recipientAddress}
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
                              {history.includes(request.uuid) && (
                                <Text style={styles.muted}>{request.executionNotes}</Text>
                              )}
                            </>
                          )}
                        </View>
                      ))
                    )}
                  </ReadResult>
                </Section>
                <Section title="Authorised share requests">
                  <Text style={styles.muted}>
                    Retained original capital request history. New increases use the company workflow below.
                  </Text>
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
              </>
            )}
          </>
        )}
        <DeploymentFlow
          key={`${uuid}/${data.epoch}/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
          uuid={uuid}
          data={data}
        />
        <CompanyIssueFlow
          key={`company-issues/${uuid}/${data.epoch}/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
          uuid={uuid}
          data={data}
        />
        <CompanyCapitalFlow
          key={`company-capital/${uuid}/${data.epoch}/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
          uuid={uuid}
          data={data}
        />
        <CompanyPauseFlow
          key={`company-pause/${uuid}/${data.epoch}/${data.owner?.userUuid}/${data.owner?.ownerAccountUuid}`}
          uuid={uuid}
          data={data}
        />
      </Page>
    </>
  );
}
