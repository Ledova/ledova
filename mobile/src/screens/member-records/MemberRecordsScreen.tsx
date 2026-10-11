import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Text, View } from 'react-native';
import { formatShareCount, useMemberRecords } from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { Field } from '../company-register/RegisterFields';
import { useCompanyStyles } from '../company-register/styles';

export function MemberRecordsScreen() {
  const read = useMemberRecords(apiClient, Crypto.randomUUID, orderSubmissionSession);
  return (
    <MemberRecords
      key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      read={read}
    />
  );
}

function MemberRecords({ read }: { read: ReturnType<typeof useMemberRecords> }) {
  const styles = useCompanyStyles();
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const held = read.busy || !!read.retry;
  return (
    <Page
      title="Your member records"
      lede="Company-recorded holdings and particulars; member access gives no company appointment and needs no wallet."
      keyboardShouldPersistTaps="handled"
    >
      <Action label="Refresh member records" disabled={read.busy} onPress={() => void read.refresh()} />
      {read.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {read.error}
        </Text>
      )}
      {!read.owner ? (
        <Text style={styles.muted}>Check your signed-in account before opening member records.</Text>
      ) : (
        <>
          <Section title="Accept a member invitation">
            <Text style={styles.muted}>
              Use the one-time code privately supplied by the company for your confirmed email. It grants access to that
              member&apos;s records, not company administration.
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
          </Section>
          {read.retry && (
            <Action label="Retry original member action" disabled={read.busy} onPress={() => void read.recover()} />
          )}
          <Section title="Your member records">
            {read.loading ? (
              <Text style={styles.muted}>Loading member records…</Text>
            ) : read.records.length === 0 ? (
              <Text style={styles.muted}>No currently associated member records are available.</Text>
            ) : (
              read.records.map((record) => (
                <Action
                  key={record.uuid}
                  label={`Open ${record.company.name} member record`}
                  disabled={held}
                  onPress={() => {
                    read.select(record.uuid);
                    setName('');
                    setAddress('');
                    setConfirmed(false);
                  }}
                />
              ))
            )}
          </Section>
          {read.record && (
            <>
              <Section title={read.record.company.name}>
                <Text style={styles.muted}>
                  Particulars provided by the company; not verified by Ledova. Profile edits do not change this
                  register.
                </Text>
                <Text style={styles.text}>{read.record.name}</Text>
                <Text style={styles.text}>{read.record.residentialAddress}</Text>
                {read.record.classes.map((item) => (
                  <View key={item.uuid} style={styles.entry}>
                    <Text style={styles.text}>
                      {item.name} · {formatShareCount(item.shares)} issued shares
                    </Text>
                    <Text style={styles.muted}>
                      Entered {item.enteredOn ?? 'not recorded'}
                      {item.ceasedOn ? ` · Ceased ${item.ceasedOn}` : ''} · Amount paid{' '}
                      {item.amountPaid ?? 'not recorded'}
                    </Text>
                    <Action
                      label={`Read own entries for ${item.name}`}
                      disabled={held}
                      onPress={() => read.selectToken(item.uuid)}
                    />
                  </View>
                ))}
                {read.entries.map((entry) => (
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
              </Section>
              <Section title="Your employee awards">
                <Text style={styles.muted}>
                  Awards are promised entitlements. Recorded vesting is separate from issued shares; dates do not vest
                  an award automatically.
                </Text>
                {read.record.awards.length === 0 ? (
                  <Text style={styles.muted}>No employee awards recorded.</Text>
                ) : (
                  read.record.awards.map((award) => (
                    <View key={award.uuid} style={styles.entry}>
                      <Text style={styles.text}>
                        {formatShareCount(award.shares)} awarded · {formatShareCount(award.vestedShares)} vested ·{' '}
                        {formatShareCount(award.issuedShares)} issued · {formatShareCount(award.availableShares)}{' '}
                        available
                      </Text>
                      <Text style={styles.text}>
                        {award.termsOn} · {award.terms}
                      </Text>
                      <Text style={styles.text}>{award.schedule}</Text>
                      {award.vestings.map((vesting) => (
                        <Text key={vesting.uuid} style={styles.text}>
                          {vesting.vestedOn} · {formatShareCount(vesting.shares)} recorded vested
                        </Text>
                      ))}
                    </View>
                  ))
                )}
              </Section>
              <Section title="Request a register particulars change">
                <Text style={styles.muted}>
                  The company reviews this request and prepares a separate evidenced instruction. Sending it changes no
                  holding or register particulars.
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
              </Section>
              {read.requests && (
                <Section title="Your request status">
                  {read.requests.particulars.map((request) => (
                    <Text key={request.uuid} style={styles.text}>
                      Particulars request {request.uuid} · {request.status}
                      {request.change ? ` · Company instruction ${request.change}` : ''}
                    </Text>
                  ))}
                  <Text style={styles.muted}>
                    A certificate request does not create a certificate. Fulfilment remains separate company output
                    work.
                  </Text>
                  {read.requests.certificates.map((request) => (
                    <View key={request.uuid} style={styles.entry}>
                      <Text style={styles.text}>
                        Certificate request {request.uuid} · {request.status} · Entry {request.entry}
                      </Text>
                      {request.status === 'requested' && (
                        <Action
                          label={`Withdraw certificate request ${request.uuid}`}
                          disabled={held}
                          onPress={() => void read.withdraw(request.uuid)}
                        />
                      )}
                    </View>
                  ))}
                </Section>
              )}
            </>
          )}
        </>
      )}
    </Page>
  );
}
