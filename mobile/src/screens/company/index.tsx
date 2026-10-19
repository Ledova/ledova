import { useState } from 'react';
import { Text, RefreshControl } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import type { Company } from '@ledova/shared';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { Action, LinkRow, Row, Section, Rows } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { CompanyReadNotice } from '../../components/company/CompanyState';
import { EditCompanyForm } from './EditCompanyForm';
import { CompanyDocuments } from './CompanyDocuments';
import { CompanySelection } from '../../components/company/CompanySelection';

export function CompanyScreen() {
  const data = useCompanyProfile();
  return <CompanyDetails key={`${data.scopeKey}/${data.companyUuid ?? 'unselected'}`} data={data} />;
}

function CompanyDetails({ data }: { data: ReturnType<typeof useCompanyProfile> }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<CompanyStackParamList>>();
  const { company } = data;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: data.companyKey }),
      queryClient.invalidateQueries({ queryKey: data.companiesKey }),
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
              <LinkRow label="Representative authority" onPress={() => navigation.navigate('CompanyAuthority')} />
              <LinkRow label="Company team" onPress={() => navigation.navigate('CompanyTeam')} />
              {data.ownerBusiness && (
                <LinkRow label="Published to your members" onPress={() => navigation.navigate('CompanyPublications')} />
              )}
            </Rows>
          </Section>
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
    </>
  );
}
