import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatDate } from '@ledova/shared';
import { LinkRow, Rows, Section, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { awardQuantity, shareQuantity } from './holdings';
import { MemberNotice, RecordGate, useCompanyRecord, useMemberRefresh } from './MemberRecordsProvider';

export function CompanyScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Company'> }) {
  const styles = useCompanyStyles();
  const card = useCardStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const uuid = route.params.record;
  const { read, record } = useCompanyRecord(uuid);
  const refresh = useMemberRefresh(read, 'company-refresh');
  const name = record?.company.name;
  useEffect(() => {
    if (name) navigation.setOptions({ title: name });
  }, [navigation, name]);
  return (
    <Page
      testID="company-scroll"
      title={record?.company.name ?? 'Company'}
      lede={record ? `ACN ${record.company.acn}` : undefined}
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      <RecordGate read={read} record={record} ready>
        {record && (
          <>
            <Section title="Your shares">
              {record.classes.length === 0 && record.awards.length === 0 ? (
                <Text style={styles.muted}>No issued shares recorded.</Text>
              ) : (
                <Rows>
                  {record.classes.map((item) => (
                    <LinkRow
                      key={item.uuid}
                      label={`${item.name} shares`}
                      accessibilityLabel={`${item.name} shares, ${shareQuantity(item.shares)}`}
                      aside={<Text style={styles.text}>{shareQuantity(item.shares)}</Text>}
                      onPress={() => navigation.navigate('Class', { record: uuid, token: item.uuid })}
                    >
                      {item.ceasedOn ? <Text style={styles.muted}>Ceased {formatDate(item.ceasedOn)}</Text> : null}
                    </LinkRow>
                  ))}
                  {record.awards.map((award) => (
                    <LinkRow
                      key={award.uuid}
                      label="Employee award"
                      accessibilityLabel={`Employee award, ${awardQuantity(award)}`}
                      onPress={() => navigation.navigate('Award', { record: uuid, award: award.uuid })}
                    >
                      <Text style={styles.muted}>{awardQuantity(award)}</Text>
                    </LinkRow>
                  ))}
                </Rows>
              )}
            </Section>
            <View style={card.card}>
              <Rows>
                <LinkRow
                  label="Documents"
                  onPress={() =>
                    navigation.popTo('Main', { screen: 'Documents', params: { company: record.company.uuid } })
                  }
                >
                  <Text style={styles.muted}>Certificates and notices</Text>
                </LinkRow>
                <LinkRow
                  label="Your details"
                  accessibilityLabel={`Your details: ${record.name}`}
                  onPress={() => navigation.navigate('Details', { record: uuid })}
                >
                  <Text style={styles.muted}>
                    {record.name} · {record.residentialAddress}
                  </Text>
                </LinkRow>
              </Rows>
            </View>
          </>
        )}
      </RecordGate>
    </Page>
  );
}
