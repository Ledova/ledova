import { useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { RefreshControl, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import {
  REGISTER_AWARD_COPY as AWARD_COPY,
  formatShareCount,
  formatDateTime,
  useMemberRecords,
  getMemberCertificateFileBytes,
  type MemberCertificateRequest,
} from '@ledova/shared';
import { Action, Choice, Section, Row, Rows } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme } from '../../contexts';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { Field } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { useMemberRecordsState } from './MemberRecordsProvider';

export function CompanyScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Company'> }) {
  const uuid = route.params.record;
  const { read, select } = useMemberRecordsState();
  useEffect(() => {
    if (read.owner && read.records.some((row) => row.uuid === uuid) && !read.busy && !read.retry) select(uuid);
  }, [read.owner, read.records, read.busy, read.retry, select, uuid]);
  return (
    <Company
      key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      read={read}
      uuid={uuid}
    />
  );
}

function Company({ read, uuid }: { read: ReturnType<typeof useMemberRecords>; uuid: string }) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const {
    draft: { name, address, confirmed },
    setDraft,
  } = useMemberRecordsState();
  const [details, setDetails] = useState(false);
  const [history, setHistory] = useState(false);
  const [requests, setRequests] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [awardDetails, setAwardDetails] = useState<Record<string, boolean>>({});
  const held = read.busy || !!read.retry;
  const record = read.records.find((row) => row.uuid === uuid);
  const selected = read.record?.uuid === uuid ? read.record : null;
  return (
    <Page
      testID="company-scroll"
      title={record?.company.name ?? 'Company'}
      lede={record ? `ACN ${record.company.acn}` : undefined}
      refreshControl={
        <RefreshControl
          testID="company-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (read.busy || refreshing) return;
            setRefreshing(true);
            void read.refresh().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {read.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {read.error}
        </Text>
      )}
      {read.retry && (
        <Action label="Retry original member action" disabled={read.busy} onPress={() => void read.recover()} />
      )}
      {!read.owner ? (
        <Text style={styles.muted}>Check your signed-in account before opening member records.</Text>
      ) : read.loading || (!read.listReady && !read.error) ? (
        <Text style={styles.muted}>Loading member records…</Text>
      ) : !record ? (
        !read.error && <Text style={styles.muted}>This company no longer records you as a member.</Text>
      ) : (
        <>
          <Section title="Your shares">
            {record.classes.length === 0 ? (
              <Text style={styles.muted}>No issued shares recorded.</Text>
            ) : (
              record.classes.map((item) => (
                <View key={item.uuid} style={styles.entry}>
                  <Text style={styles.text}>
                    {item.name} · {formatShareCount(item.shares)} issued shares
                  </Text>
                  {selected && (
                    <Action
                      label={`Read own entries for ${item.name}`}
                      disabled={held}
                      onPress={() => {
                        read.selectToken(item.uuid);
                        setHistory(true);
                      }}
                    />
                  )}
                </View>
              ))
            )}
            {record.awards.length > 0 && (
              <>
                <Text accessibilityRole="header" style={styles.text}>
                  Employee awards
                </Text>
                <Text style={styles.muted}>Promised and recorded vested shares are separate from issued shares.</Text>
                {record.awards.map((award) => (
                  <View key={award.uuid} style={styles.entry}>
                    <Text style={styles.text}>
                      {formatShareCount(award.shares)} awarded · {formatShareCount(award.vestedShares)} vested ·{' '}
                      {formatShareCount(award.issuedShares)} issued · {formatShareCount(award.availableShares)}{' '}
                      available
                    </Text>
                    <Action
                      label="Award terms and recorded vesting"
                      accessibilityLabel={`Award terms and recorded vesting ${award.uuid}`}
                      onPress={() => setAwardDetails((value) => ({ ...value, [award.uuid]: !value[award.uuid] }))}
                    />
                    {awardDetails[award.uuid] && (
                      <View style={styles.group}>
                        <Text style={styles.muted}>
                          {award.termsOn} · {award.terms}
                        </Text>
                        <Text style={styles.muted}>{award.schedule}</Text>
                        <Rows>
                          <Row label={AWARD_COPY.ENDED_UNVESTED}>{award.endedUnvestedShares}</Row>
                          <Row label={AWARD_COPY.ENDED_VESTED}>{award.endedVestedShares}</Row>
                          <Row label={AWARD_COPY.UNVESTED_REMAINING}>{award.unvestedRemainingShares}</Row>
                          <Row label={AWARD_COPY.REMAINING_UNISSUED}>{award.remainingUnissuedShares}</Row>
                        </Rows>
                        {award.vestings.map((event) => (
                          <Text key={event.uuid} style={styles.muted}>
                            {event.vestedOn} · {formatShareCount(event.shares)} recorded vested
                          </Text>
                        ))}
                        {award.ends.map((event) => (
                          <Text key={event.uuid} style={styles.muted}>
                            {event.companyEventOn} · {formatShareCount(event.unvestedShares)} unvested and{' '}
                            {formatShareCount(event.vestedShares)} vested unissued rights ended · {event.reason}
                          </Text>
                        ))}
                        {award.vestingReversals.map((event) => (
                          <Text key={event.uuid} style={styles.muted}>
                            {event.companyEventOn} · {formatShareCount(event.reversedShares)} vesting reversed ·
                            original {event.vesting} · {event.reason}
                          </Text>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
          </Section>
          {!selected && read.retry && (
            <Text style={styles.muted}>Retry or finish your pending request before opening this company.</Text>
          )}
          {selected && (
            <>
              {read.requests?.certificates.some((request) => request.status === 'fulfilled' && request.fulfilment) && (
                <Section title="Documents">
                  <Text style={styles.muted}>
                    Unsigned copies of your receiving entries; the company is responsible for execution.
                  </Text>
                  {read.requests.certificates
                    .filter((request) => request.status === 'fulfilled' && request.fulfilment)
                    .map((request) => (
                      <MemberCertificateCopy key={request.uuid} read={read} request={request} />
                    ))}
                </Section>
              )}
              <Section title="Your member details">
                <Action
                  label={details ? 'Hide member details' : 'Open member details'}
                  disabled={held}
                  onPress={() => setDetails((value) => !value)}
                />
                {details && (
                  <View style={styles.group}>
                    <Text style={styles.text}>{selected.name}</Text>
                    <Text style={styles.text}>{selected.residentialAddress}</Text>
                    <Text style={styles.muted}>
                      Particulars provided by the company; not verified by Ledova. Profile edits do not change this
                      register.
                    </Text>
                    {selected.classes.map((item) => (
                      <Text key={item.uuid} style={styles.muted}>
                        {item.name} · Entered {item.enteredOn ?? 'not recorded'}
                        {item.ceasedOn ? ` · Ceased ${item.ceasedOn}` : ''} · Amount paid{' '}
                        {item.amountPaid ?? 'not recorded'}
                      </Text>
                    ))}
                    <Text accessibilityRole="header" style={styles.text}>
                      Request a particulars change
                    </Text>
                    <Text style={styles.muted}>
                      The company reviews this request separately. Sending it changes no holding or register
                      particulars.
                    </Text>
                    <Field
                      label="Requested name"
                      value={name}
                      editable={!held}
                      onChange={(value) => setDraft((draft) => ({ ...draft, name: value, confirmed: false }))}
                    />
                    <Field
                      label="Requested residential address"
                      value={address}
                      editable={!held}
                      multiline
                      onChange={(value) => setDraft((draft) => ({ ...draft, address: value, confirmed: false }))}
                    />
                    <Choice
                      accessibilityRole="checkbox"
                      selected={confirmed}
                      disabled={held}
                      label="Share these particulars with this company for review"
                      onPress={() => setDraft((draft) => ({ ...draft, confirmed: !draft.confirmed }))}
                    />
                    <Action
                      label="Send particulars request"
                      disabled={held || !confirmed || !name.trim() || !address.trim()}
                      onPress={() => void read.requestParticulars(name.trim(), address.trim())}
                    />
                  </View>
                )}
                <Action
                  label={history ? 'Hide own entry history' : 'Open own entry history'}
                  disabled={held}
                  onPress={() => setHistory((value) => !value)}
                />
                {history &&
                  read.entries.map((entry) => (
                    <View key={entry.uuid} style={styles.entry}>
                      <Text style={styles.text}>
                        Entry {entry.sequence} · {entry.kind} · Own change {entry.delta}
                      </Text>
                      <Text style={styles.muted}>Ledger effective date {entry.effectiveOn}</Text>
                      {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) && (
                        <Text style={styles.muted}>Company event date {entry.companyEventOn ?? 'Not recorded'}</Text>
                      )}
                      <Text style={styles.muted}>Recorded {formatDateTime(entry.createdAt)}</Text>
                      {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) && BigInt(entry.delta) > 0n && (
                        <Action
                          label={`Request certificate for entry ${entry.sequence}`}
                          disabled={held}
                          onPress={() => void read.requestCertificate(entry.uuid)}
                        />
                      )}
                    </View>
                  ))}
                {read.requests && (read.requests.particulars.length > 0 || read.requests.certificates.length > 0) && (
                  <>
                    <Action
                      label={requests ? 'Hide request status' : 'Open request status'}
                      disabled={held}
                      onPress={() => setRequests((value) => !value)}
                    />
                    {requests && (
                      <View style={styles.group}>
                        {read.requests.particulars.map((request) => (
                          <Text key={request.uuid} style={styles.text}>
                            Particulars update · {request.status}
                          </Text>
                        ))}
                        {read.requests.certificates
                          .filter((request) => request.status !== 'fulfilled')
                          .map((request) => (
                            <View key={request.uuid} style={styles.entry}>
                              <Text style={styles.text}>Certificate request · {request.status}</Text>
                              {request.status === 'requested' && (
                                <Action
                                  label="Withdraw certificate request"
                                  accessibilityLabel={`Withdraw certificate request ${request.uuid}`}
                                  disabled={held}
                                  onPress={() => void read.withdraw(request.uuid)}
                                />
                              )}
                            </View>
                          ))}
                      </View>
                    )}
                  </>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </Page>
  );
}

function MemberCertificateCopy({
  read,
  request,
}: {
  read: ReturnType<typeof useMemberRecords>;
  request: MemberCertificateRequest;
}) {
  const guard = () => {
    read.guardCertificate(request.uuid);
  };
  return (
    <RegisterCopy
      label="Share unsigned certificate"
      accessibilityLabel={`Share own unsigned certificate ${request.uuid}`}
      filename={`member-certificate-${request.uuid}`}
      epoch={orderSubmissionSession.getEpoch()}
      guard={guard}
      read={async () => {
        const captured = read.guardCertificate(request.uuid);
        const check = () => {
          const current = read.guardCertificate(request.uuid);
          if (
            current.uuid !== captured.uuid ||
            current.digest !== captured.digest ||
            current.fileSize !== captured.fileSize
          )
            throw new Error('The certificate fulfilment changed. Refresh your records.');
        };
        check();
        const response = await getMemberCertificateFileBytes(apiClient, request.uuid, {
          ...orderSubmissionSession.requestConfig(),
          ledovaSubmissionGuard: check,
        });
        check();
        if (
          !(response.data instanceof ArrayBuffer) ||
          response.data.byteLength !== captured.fileSize ||
          String(response.headers['content-type']).split(';')[0] !== 'application/pdf'
        )
          throw new Error('The recipient certificate PDF could not be confirmed.');
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(response.data));
        check();
        if (
          Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('') !==
          captured.digest
        )
          throw new Error('The recipient certificate digest does not match its retained record.');
        return response;
      }}
    />
  );
}
