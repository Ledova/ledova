import { Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { MEMBER_PARTICULARS_STATUS_LABELS, formatDate } from '@ledova/shared';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { MemberNotice, RecordGate, useCompanyRecord, useMemberRefresh } from './MemberRecordsProvider';

export function DetailsScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Details'> }) {
  const styles = useCompanyStyles();
  const {
    read,
    record,
    selected,
    draft: { name, address, confirmed },
    setDraft,
  } = useCompanyRecord(route.params.record);
  const held = read.busy || !!read.retry;
  const refresh = useMemberRefresh(read, 'details-scroll-refresh');
  return (
    <Page testID="details-scroll" title="Your details" lede={record?.company.name} refreshControl={refresh}>
      <MemberNotice read={read} />
      <RecordGate read={read} record={record} ready={!!selected}>
        {selected && (
          <>
            <Section title="On the register">
              <Rows>
                <Row label="Name">{selected.name}</Row>
                <Row label="Address">{selected.residentialAddress}</Row>
                {selected.classes.map((item) => (
                  <Row key={item.uuid} label={item.name}>
                    Entered {item.enteredOn ? formatDate(item.enteredOn) : 'not recorded'}
                    {item.ceasedOn ? ` · Ceased ${formatDate(item.ceasedOn)}` : ''} · Amount paid{' '}
                    {item.amountPaid ?? 'not recorded'}
                  </Row>
                ))}
              </Rows>
              <Text style={styles.muted}>
                Particulars provided by the company; not verified by Ledova. Profile edits do not change this register.
              </Text>
            </Section>
            <Section title="Request a particulars change">
              <View style={styles.group}>
                <Text style={styles.muted}>
                  The company reviews this request separately. Sending it changes no holding or register particulars.
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
            </Section>
            {read.requests && read.requests.particulars.length > 0 && (
              <Section title="Your requests">
                <Rows>
                  {read.requests.particulars.map((request) => (
                    <Row key={request.uuid} label={`Requested ${formatDate(request.createdAt)}`}>
                      {MEMBER_PARTICULARS_STATUS_LABELS[request.status]}
                    </Row>
                  ))}
                </Rows>
              </Section>
            )}
          </>
        )}
      </RecordGate>
    </Page>
  );
}
