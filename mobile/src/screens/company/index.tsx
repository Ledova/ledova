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

export function CompanyScreen() {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<CompanyStackParamList & BottomTabParamList>>();
  const data = useCompanyProfile();
  const { company } = data;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const [creating, setCreating] = useState<Company | null>(null);
  const classes = useQuery({
    queryKey: ['company-tokens', 'company', company?.uuid],
    enabled: data.access.allowed && !!company && !data.error,
    queryFn: async () =>
      (await readEveryPage((page) => getCompanyTokens(apiClient, { page }))).filter(
        (token) => token.companyUuid === company!.uuid,
      ),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['company'] }),
      queryClient.invalidateQueries({ queryKey: ['companies'] }),
      queryClient.invalidateQueries({ queryKey: ['company-tokens'] }),
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
  if (!data.access.allowed)
    return (
      <Page title="Company">
        <Text style={styles.muted}>
          {data.access.isLoading
            ? 'Loading your company access…'
            : 'Verify your company access before opening Company.'}
        </Text>
        {data.access.isError && <Action label="Retry company access" onPress={() => void data.access.refetch()} />}
      </Page>
    );
  return (
    <>
      <Page
        testID="company-screen"
        title="Company"
        actions={
          !data.error &&
          company && <Action label="Edit company" onPress={() => setEditing(company)} disabled={data.isRefreshing} />
        }
        refreshControl={<RefreshControl refreshing={data.isRefreshing} onRefresh={() => void refresh()} />}
      >
        {data.isLoading ? (
          <Text style={styles.muted}>Loading company information…</Text>
        ) : data.error ? (
          <CompanyReadNotice read={data} />
        ) : !company ? (
          <Text style={styles.muted}>No company information available.</Text>
        ) : (
          <>
            <Section title={company.name}>
              <Rows>
                <Row label="Status">{company.statusDisplay}</Row>
                {company.tradingName && <Row label="Trading name">{company.tradingName}</Row>}
                <Row label="Type">{company.companyTypeDisplay}</Row>
                <Row label="ACN">{company.acn}</Row>
                {company.abn && <Row label="ABN">{company.abn}</Row>}
                {company.email && <Row label="Email">{company.email}</Row>}
                {company.phone && <Row label="Phone">{company.phone}</Row>}
                {!!address && <Row label="Address">{address}</Row>}
              </Rows>
              <Rows>
                <LinkRow label="Application" onPress={() => navigation.navigate('Listing')} />
                <LinkRow label="Published to your members" onPress={() => navigation.navigate('CompanyPublications')} />
              </Rows>
            </Section>
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
          </>
        )}
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
