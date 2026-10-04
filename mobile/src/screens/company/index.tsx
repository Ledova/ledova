import { useState } from 'react';
import { Text, View, RefreshControl } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompanyTokens, formatShareCount, readEveryPage, type Company } from '@ledova/shared';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import type { BottomTabParamList } from '../../navigation/BottomTabNavigator';
import { Action, LinkRow, Row, Section, Rows } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import { apiClient } from '../../services/apiClient';
import { useCompanyStyles } from '../company-register/styles';
import { CompanyReadNotice } from './CompanyState';
import { CreateClassForm, EditCompanyForm } from './CompanyForms';
import { CompanyDocuments } from './CompanyDocuments';
import { CompanySelection } from './CompanySelection';

export function CompanyScreen() {
  const data = useCompanyProfile();
  return <CompanyDetails key={`${data.scopeKey}/${data.companyUuid ?? 'unselected'}`} data={data} />;
}

function CompanyDetails({ data }: { data: ReturnType<typeof useCompanyProfile> }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<CompanyStackParamList & BottomTabParamList>>();
  const { company } = data;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const [creating, setCreating] = useState<Company | null>(null);
  const classes = useQuery({
    queryKey: ['company-tokens', 'company', data.companyUuid, data.scopeKey],
    enabled: data.ownerBusiness && !!company && !data.error,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        data.assertCurrent(company!.uuid, 'owner');
        const result = await getCompanyTokens(apiClient, { page });
        data.assertCurrent(company!.uuid, 'owner');
        return result;
      });
      return rows.filter((token) => token.companyUuid === company!.uuid);
    },
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: data.companyKey }),
      queryClient.invalidateQueries({ queryKey: data.companiesKey }),
      queryClient.invalidateQueries({ queryKey: ['company-tokens', 'company', data.companyUuid, data.scopeKey] }),
    ]);
  const address = company
    ? [
        company.addressLine1,
        company.addressLine2,
        [company.city, company.state, company.postcode].filter(Boolean).join(' '),
        company.country,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  return (
    <>
      <Page
        testID="company-screen"
        title="Company"
        actions={
          data.canAdmin &&
          company && <Action label="Edit company" onPress={() => setEditing(company)} disabled={data.isRefreshing} />
        }
        refreshControl={<RefreshControl refreshing={data.isRefreshing} onRefresh={() => void refresh()} />}
      >
        <CompanySelection read={data} />
        {data.isLoading ? (
          <Text style={styles.muted}>Loading company information…</Text>
        ) : data.error ? (
          <CompanyReadNotice read={data} />
        ) : !company ? (
          <Text style={styles.muted}>
            {data.companies.length > 0 ? 'Choose a company above.' : 'No company administration available.'}
          </Text>
        ) : (
          <>
            <Section title={company.name}>
              <Text style={styles.muted}>Company information is provided by the company.</Text>
              <Rows>
                <Row label="Status">{company.statusDisplay}</Row>
                {company.tradingName && <Row label="Trading name">{company.tradingName}</Row>}
                <Row label="Type">{company.companyTypeDisplay}</Row>
                <Row label="ACN">{company.acn}</Row>
                {company.abn && <Row label="ABN">{company.abn}</Row>}
                {data.canAdmin && company.email && <Row label="Email">{company.email}</Row>}
                {company.phone && <Row label="Phone">{company.phone}</Row>}
                {!!address && <Row label="Address">{address}</Row>}
              </Rows>
              <Rows>
                {data.ownerBusiness && <LinkRow label="Application" onPress={() => navigation.navigate('Listing')} />}
                <LinkRow label="Representative authority" onPress={() => navigation.navigate('CompanyAuthority')} />
                <LinkRow label="Company team" onPress={() => navigation.navigate('CompanyTeam')} />
                {data.ownerBusiness && (
                  <LinkRow
                    label="Published to your members"
                    onPress={() => navigation.navigate('CompanyPublications')}
                  />
                )}
              </Rows>
            </Section>
            {data.ownerBusiness && (
              <Section title={classes.isSuccess ? `Share classes (${classes.data.length})` : 'Share classes'}>
                {classes.isPending ? (
                  <Text style={styles.muted}>Loading share classes…</Text>
                ) : classes.isError ? (
                  <View style={styles.group}>
                    <Text accessibilityRole="alert" style={styles.error}>
                      Share classes could not be loaded.
                    </Text>
                    <Action
                      label="Retry share classes"
                      disabled={classes.isFetching}
                      onPress={() => void classes.refetch()}
                    />
                  </View>
                ) : classes.data.length === 0 ? (
                  <Text style={styles.muted}>No share classes yet.</Text>
                ) : (
                  <Rows>
                    {classes.data.map((token) => (
                      <LinkRow
                        key={token.uuid}
                        label={token.name}
                        onPress={() => navigation.navigate('TokenDetail', { uuid: token.uuid })}
                      >
                        <Text style={styles.text}>{token.statusDisplay}</Text>
                        <Text style={styles.muted}>
                          {token.symbol} · {token.tokenTypeDisplay}
                        </Text>
                        <Text style={styles.muted}>{formatShareCount(token.totalSupply)} authorised shares</Text>
                      </LinkRow>
                    ))}
                    <LinkRow label="Register" onPress={() => navigation.navigate('CompanyMain')} />
                  </Rows>
                )}
                <Action label="Create share class" disabled={data.isRefreshing} onPress={() => setCreating(company)} />
              </Section>
            )}
          </>
        )}
        {data.retainedCompany && <CompanyDocuments read={data} />}
      </Page>
      {editing && (
        <EditCompanyForm
          target={editing}
          company={company}
          read={data}
          onClose={() => setEditing(null)}
          onSuccess={refresh}
        />
      )}
      {creating && (
        <CreateClassForm
          target={creating}
          company={company}
          read={data}
          onClose={() => setCreating(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}
