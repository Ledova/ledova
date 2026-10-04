import { RefreshControl, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Action, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import type { BottomTabParamList } from '../../navigation/BottomTabNavigator';
import { CompanyReadNotice } from '../company/CompanyState';
import { CompanySelection } from '../company/CompanySelection';
import { useCompanyStyles } from '../company-register/styles';
import { PublicationRecord } from './PublicationRecord';
import { useIssuerPublications } from './useIssuerPublications';

const TITLE = 'Published to your members';

export function CompanyPublicationsScreen() {
  const companyRead = useCompanyProfile({ ownedOnly: true });
  return (
    <IssuerPublications key={`${companyRead.scopeKey}:${companyRead.companyUuid ?? ''}`} companyRead={companyRead} />
  );
}

function IssuerPublications({ companyRead }: { companyRead: ReturnType<typeof useCompanyProfile> }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<BottomTabParamList>>();
  const { access, company } = companyRead;
  const { listing, open, openingUuid, openError, blocked } = useIssuerPublications(companyRead);
  const publications = listing.data;
  const refreshing = companyRead.isRefreshing || listing.isFetching;
  const refresh = async () => {
    if (!access.allowed) return;
    await companyRead.refetch();
    if (company) await listing.refetch();
  };
  if (!access.allowed)
    return (
      <Page title={TITLE}>
        <Text style={styles.muted}>
          {access.isLoading ? 'Loading your company access…' : 'Verify your company access before opening Company.'}
        </Text>
        {access.isError && <Action label="Retry company access" onPress={() => void access.refetch()} />}
      </Page>
    );
  return (
    <Page
      testID="company-publications-screen"
      title={TITLE}
      lede="Staff prepare and publish these records on your company's written instruction."
      actions={<Action label="Refresh" disabled={refreshing} onPress={() => void refresh()} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <CompanySelection read={companyRead} />
      {companyRead.isLoading ? (
        <Text style={styles.muted}>Loading company information…</Text>
      ) : companyRead.error ? (
        <CompanyReadNotice read={companyRead} />
      ) : !company ? (
        <Text style={styles.muted}>No company information available.</Text>
      ) : (
        <>
          <CompanyReadNotice read={companyRead} />
          {listing.isLoading ? (
            <Text style={styles.muted}>Loading company publications…</Text>
          ) : listing.isError ? (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.error}>
                Your company&apos;s publications could not be loaded. Try again before continuing.
              </Text>
              <Action label="Retry publications" onPress={() => void listing.refetch()} disabled={listing.isFetching} />
            </View>
          ) : (
            <Section title={publications ? `Publications (${publications.length})` : 'Publications'}>
              {listing.isFetching && <Text style={styles.muted}>Refreshing company publications…</Text>}
              {openError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {openError}
                </Text>
              )}
              {!publications ? null : publications.length === 0 ? (
                <Text style={styles.muted}>Nothing has been published to this company&apos;s members yet.</Text>
              ) : (
                <>
                  <Rows>
                    {publications.map((publication) => (
                      <PublicationRecord
                        key={publication.uuid}
                        publication={publication}
                        open={() => void open(publication.uuid)}
                        opening={openingUuid === publication.uuid}
                        blocked={blocked || openingUuid !== undefined}
                      />
                    ))}
                  </Rows>
                  <Text style={styles.muted}>
                    These are the stored documents as published. Company and share class names are frozen at
                    publication.
                  </Text>
                </>
              )}
            </Section>
          )}
          <View style={styles.group}>
            <Text style={styles.muted}>To read notices addressed to you or vote as a member, open Notices.</Text>
            <Action label="Open Notices" onPress={() => navigation.navigate('Publications')} />
          </View>
        </>
      )}
    </Page>
  );
}
