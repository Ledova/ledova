import { Text } from 'react-native';
import { Action, Actions, Fact, Rows, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { MemberNotice, RecordGate, useCompanyRecord, useMemberRecordsState } from '../holdings/MemberRecordsProvider';

export function CompanyRecordedDetails() {
  const styles = useCompanyStyles();
  const { company } = useMemberRecordsState();
  const { read, record, selected } = useCompanyRecord(company?.uuid ?? '');
  if (!company && read.listReady && read.records.length === 0) return null;
  return (
    <Section title={`How ${company?.company.name ?? 'the company'} records you`}>
      <MemberNotice read={read} />
      {read.readFailed ? (
        <Actions>
          <Action label="Try again" disabled={read.busy} onPress={() => void read.refresh()} />
        </Actions>
      ) : !company && read.listReady ? (
        <Text style={styles.muted}>Loading member records…</Text>
      ) : (
        <RecordGate read={read} record={record} ready={!!selected}>
          {selected && (
            <>
              <Rows>
                <Fact label="Name">{selected.name}</Fact>
                <Fact label="Residential address">{selected.residentialAddress}</Fact>
              </Rows>
              <Text style={styles.muted}>Wrong? Contact the company.</Text>
            </>
          )}
        </RecordGate>
      )}
    </Section>
  );
}
