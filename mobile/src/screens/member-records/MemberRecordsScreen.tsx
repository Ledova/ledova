import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Text, View } from 'react-native';
import {
  DESTINATIONS,
  formatShareCount,
  useMemberRecords,
  getMemberCertificateFileBytes,
  type MemberCertificateRequest,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { Field } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { RegisterCopy } from '../../components/register/RegisterCopy';

export function MemberRecordsScreen() {
  const read = useMemberRecords(Crypto.randomUUID, orderSubmissionSession);
  const selectionOwner = useRef<ReturnType<typeof useMemberRecords>['owner']>(null);
  useEffect(() => {
    if (read.owner && selectionOwner.current !== read.owner && read.records.length === 1 && !read.busy && !read.retry) {
      selectionOwner.current = read.owner;
      read.select(read.records[0].uuid);
    }
  }, [read.owner, read.records, read.busy, read.retry, read.select]);
  return (
    <MemberRecords
      key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      read={read}
      select={(uuid) => {
        selectionOwner.current = read.owner;
        read.select(uuid);
      }}
    />
  );
}

function MemberRecords({
  read,
  select,
}: {
  read: ReturnType<typeof useMemberRecords>;
  select: (uuid: string) => void;
}) {
  const styles = useCompanyStyles();
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [details, setDetails] = useState(false);
  const [history, setHistory] = useState(false);
  const [requests, setRequests] = useState(false);
  const [invitationOpen, setInvitationOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [awardDetails, setAwardDetails] = useState<Record<string, boolean>>({});
  const held = read.busy || !!read.retry;
  const invitation = (
    <View style={styles.group}>
      <Text style={styles.muted}>
        Use the one-time code privately supplied by the company for your confirmed email. It grants access to your
        member record, not company administration.
      </Text>
      <Field
        label="Member invitation code"
        value={code}
        editable={!held}
        onChange={(value) => {
          setCode(value);
          setAccepted(false);
        }}
      />
      <Choice
        accessibilityRole="checkbox"
        selected={accepted}
        disabled={held}
        label="Accept access using my signed-in account"
        onPress={() => setAccepted((value) => !value)}
      />
      <Action
        label="Accept member invitation"
        disabled={held || !accepted || !/^[A-Za-z0-9_-]{43}$/.test(code)}
        onPress={() => void read.accept(code)}
      />
    </View>
  );
  return (
    <Page
      title={DESTINATIONS.home.title}
      lede="Your company-recorded shares and employee awards. No wallet is needed."
      keyboardShouldPersistTaps="handled"
      actions={
        <Action
          label="Refresh member records"
          disabled={read.busy || refreshing}
          onPress={() => {
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
      ) : read.loading || refreshing || (read.busy && read.records.length === 0) ? (
        <Text style={styles.muted}>Loading member records…</Text>
      ) : (
        <>
          {read.records.map((record) => (
            <Section key={record.uuid} title={record.company.name}>
              {record.classes.length === 0 ? (
                <Text style={styles.muted}>No issued shares recorded.</Text>
              ) : (
                record.classes.map((item) => (
                  <View key={item.uuid} style={styles.entry}>
                    <Text style={styles.text}>
                      {item.name} · {formatShareCount(item.shares)} issued shares
                    </Text>
                    {read.record?.uuid === record.uuid && (
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
                          {award.vestings.map((event) => (
                            <Text key={event.uuid} style={styles.muted}>
                              {event.vestedOn} · {formatShareCount(event.shares)} recorded vested
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
              {read.record?.uuid !== record.uuid && (
                <Action
                  label={`Open ${record.company.name} member record`}
                  disabled={held}
                  onPress={() => {
                    select(record.uuid);
                    setName('');
                    setAddress('');
                    setConfirmed(false);
                    setDetails(false);
                    setHistory(false);
                    setRequests(false);
                  }}
                />
              )}
            </Section>
          ))}
          {read.record && (
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
                    <Text style={styles.text}>{read.record.name}</Text>
                    <Text style={styles.text}>{read.record.residentialAddress}</Text>
                    <Text style={styles.muted}>
                      Particulars provided by the company; not verified by Ledova. Profile edits do not change this
                      register.
                    </Text>
                    {read.record.classes.map((item) => (
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
                      onChange={(value) => {
                        setName(value);
                        setConfirmed(false);
                      }}
                    />
                    <Field
                      label="Requested residential address"
                      value={address}
                      editable={!held}
                      multiline
                      onChange={(value) => {
                        setAddress(value);
                        setConfirmed(false);
                      }}
                    />
                    <Choice
                      accessibilityRole="checkbox"
                      selected={confirmed}
                      disabled={held}
                      label="Share these particulars with this company for review"
                      onPress={() => setConfirmed((value) => !value)}
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
                        Entry {entry.sequence} · {entry.kind} · {entry.effectiveOn} · Own change {entry.delta}
                      </Text>
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
          {!read.error && read.records.length === 0 ? (
            <Section title="Get access to your shares">
              <Text style={styles.muted}>
                Accept your company&apos;s invitation to see your shares and employee awards here.
              </Text>
              {invitation}
            </Section>
          ) : (
            <Section title="Member invitation">
              <Action
                label={invitationOpen ? 'Hide member invitation' : 'Accept another member invitation'}
                disabled={held}
                onPress={() => setInvitationOpen((value) => !value)}
              />
              {invitationOpen && invitation}
            </Section>
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
