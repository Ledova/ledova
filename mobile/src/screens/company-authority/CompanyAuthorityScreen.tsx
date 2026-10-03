import { useState, useSyncExternalStore } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  COMPANY_AUTHORITY_PENDING_NOTICE,
  getCompanies,
  getCompanyAuthorityRequests,
  readEveryPage,
} from '@ledova/shared';
import { Action, Choice, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { useCompanyStyles } from '../company-register/styles';
import { AuthorityRequestForm } from './AuthorityRequestForm';
import { AuthorityRequestRecord } from './AuthorityRequestRecord';

export function CompanyAuthorityScreen() {
  const styles = useCompanyStyles();
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const [selection, setSelection] = useState<{ epoch: number; uuid: string }>();
  const [submittedEpoch, setSubmittedEpoch] = useState<number>();
  const companies = useQuery({
    queryKey: ['companies', 'authority-requests', epoch],
    queryFn: () =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getCompanies(apiClient, page, { ledovaSessionEpoch: epoch });
        assertSessionEpoch(epoch);
        return response;
      }),
  });
  const requests = useQuery({
    queryKey: ['company-authority-requests', epoch],
    queryFn: () =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getCompanyAuthorityRequests(apiClient, undefined, page, { ledovaSessionEpoch: epoch });
        assertSessionEpoch(epoch);
        return response;
      }),
  });
  const drafts = companies.data?.filter((company) => company.status === 'draft') ?? [];
  const selected = selection?.epoch === epoch ? drafts.find((company) => company.uuid === selection.uuid) : undefined;
  const refreshing = companies.isFetching || requests.isFetching;
  const refresh = () => {
    void companies.refetch();
    void requests.refetch();
  };
  return (
    <Page
      testID="company-authority-screen"
      title="Representative authority"
      lede={COMPANY_AUTHORITY_PENDING_NOTICE}
      actions={<Action label="Refresh" disabled={refreshing} onPress={refresh} />}
      refreshControl={<RefreshControl refreshing={refreshing && !companies.isLoading} onRefresh={refresh} />}
    >
      <Section title="Submit evidence">
        <Text style={styles.muted}>Choose a draft company you own. Verify your account email before submitting.</Text>
        {companies.isPending ? (
          <Text style={styles.muted}>Loading your companies…</Text>
        ) : companies.isError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              Your companies could not be loaded. Retry before submitting.
            </Text>
            <Action label="Retry companies" disabled={companies.isFetching} onPress={() => void companies.refetch()} />
          </View>
        ) : drafts.length === 0 ? (
          <Text style={styles.muted}>You have no draft company available for an authority request.</Text>
        ) : (
          <>
            <View style={styles.choices}>
              {drafts.map((company) => (
                <Choice
                  key={company.uuid}
                  label={company.name}
                  accessibilityRole="radio"
                  selected={selected?.uuid === company.uuid}
                  disabled={companies.isFetching}
                  onPress={() => {
                    setSelection({ epoch, uuid: company.uuid });
                    setSubmittedEpoch(undefined);
                  }}
                />
              ))}
            </View>
            {!selected && <Text style={styles.muted}>Select a company to prepare your request.</Text>}
          </>
        )}
        {selected && (
          <AuthorityRequestForm
            key={`${epoch}:${selected.uuid}`}
            company={selected}
            blocked={companies.isError || companies.isFetching}
            onSubmitted={() => {
              setSubmittedEpoch(epoch);
              void requests.refetch();
            }}
          />
        )}
        {submittedEpoch === epoch && (
          <Text accessibilityRole="alert" style={styles.text}>
            Your request has been retained. {COMPANY_AUTHORITY_PENDING_NOTICE}
          </Text>
        )}
      </Section>
      <Section title="Your requests">
        <Text style={styles.muted}>
          Only your own submissions appear here. Retained requests cannot be edited or deleted.
        </Text>
        {requests.isPending ? (
          <Text style={styles.muted}>Loading your requests…</Text>
        ) : requests.isError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              Your requests could not be loaded.
            </Text>
            <Action label="Retry requests" disabled={requests.isFetching} onPress={() => void requests.refetch()} />
          </View>
        ) : requests.data.length === 0 ? (
          <Text style={styles.muted}>You have not submitted an authority request.</Text>
        ) : (
          <Rows>
            {requests.data.map((request) => (
              <AuthorityRequestRecord key={request.uuid} request={request} blocked={requests.isFetching} />
            ))}
          </Rows>
        )}
      </Section>
    </Page>
  );
}
