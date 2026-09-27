import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Action } from '../../components/Ledger';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import type { BottomTabParamList } from '../../navigation/BottomTabNavigator';
import { CompanyReadNotice } from '../company/CompanyState';
import { useCompanyStyles } from '../company-register/styles';
import { PublicationRecord } from './PublicationRecord';
import { useIssuerPublications } from './useIssuerPublications';

export function CompanyPublicationsScreen() {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<BottomTabParamList>>();
  const companyRead = useCompanyProfile();
  const { access, company } = companyRead;
  const { listing, open, openingUuid, openError, blocked } = useIssuerPublications(
    company?.uuid,
    access.allowed && !companyRead.error,
    !companyRead.isRefreshing,
  );
  const refreshing = companyRead.isRefreshing || listing.isFetching;
  const refresh = () => {
    if (!access.allowed) return;
    void companyRead.refetch();
    if (company) void listing.refetch();
  };
  if (!access.allowed)
    return (
      <View style={[styles.page, styles.content]}>
        <Text style={styles.muted}>
          {access.isLoading ? 'Loading your company access…' : 'Verify your company access before opening Company.'}
        </Text>
        {access.isError && <Action label="Retry company access" onPress={() => void access.refetch()} />}
      </View>
    );
  return (
    <ScrollView
      testID="company-publications-screen"
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Published to your members
      </Text>
      <Action label="Refresh" disabled={refreshing} onPress={refresh} />
      {companyRead.isLoading ? (
        <Text style={styles.muted}>Loading company information…</Text>
      ) : companyRead.error ? (
        <CompanyReadNotice read={companyRead} />
      ) : !company ? (
        <Text style={styles.muted}>No company information available.</Text>
      ) : (
        <>
          <Text style={styles.muted}>
            Staff prepare and publish these records on your company&apos;s written instruction.
          </Text>
          <Text style={styles.muted}>To read notices addressed to you or vote as a member, open Notices.</Text>
          <Action label="Open Notices" onPress={() => navigation.navigate('Publications')} />
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
            <>
              {listing.isFetching && <Text style={styles.muted}>Refreshing company publications…</Text>}
              {openError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {openError}
                </Text>
              )}
              {listing.data?.length === 0 ? (
                <Text style={styles.muted}>Nothing has been published to this company&apos;s members yet.</Text>
              ) : (
                <>
                  <Text style={styles.muted}>
                    {listing.data?.length} publication{listing.data?.length === 1 ? '' : 's'}
                  </Text>
                  {listing.data?.map((publication) => (
                    <PublicationRecord
                      key={publication.uuid}
                      publication={publication}
                      open={() => void open(publication.uuid)}
                      opening={openingUuid === publication.uuid}
                      blocked={blocked || openingUuid !== undefined}
                    />
                  ))}
                  <Text style={styles.muted}>
                    These are the stored documents as published. Company and share class names are frozen at
                    publication.
                  </Text>
                </>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
