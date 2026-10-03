import { useState, useSyncExternalStore } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanies,
  getCompanyAuthorityRequests,
  readEveryPage,
  withdrawCompanyAuthorityRequest,
  type CompanyAuthorityRequest,
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
  const queryClient = useQueryClient();
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const [selection, setSelection] = useState<{ epoch: number; uuid: string }>();
  const [submitted, setSubmitted] = useState<{ epoch: number; request: CompanyAuthorityRequest }>();
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
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getCompanyAuthorityRequests(apiClient, undefined, page, {
          ledovaSessionEpoch: epoch,
          signal,
        });
        assertSessionEpoch(epoch);
        return response;
      }),
  });
  const drafts = companies.data?.filter((company) => company.status === 'draft') ?? [];
  const selected = selection?.epoch === epoch ? drafts.find((company) => company.uuid === selection.uuid) : undefined;
  const submittedRequest =
    submitted?.epoch === epoch
      ? (requests.data?.find((request) => request.uuid === submitted.request.uuid) ?? submitted.request)
      : undefined;
  const refreshing = companies.isFetching || requests.isFetching;
  const refresh = () => {
    void companies.refetch();
    void requests.refetch();
  };
  const withdraw = async (request: CompanyAuthorityRequest) => {
    const queryKey = ['company-authority-requests', epoch];
    assertSessionEpoch(epoch);
    await queryClient.cancelQueries({ queryKey, exact: true });
    assertSessionEpoch(epoch);
    const response = await withdrawCompanyAuthorityRequest(apiClient, request.uuid, { ledovaSessionEpoch: epoch });
    assertSessionEpoch(epoch);
    if (response.data.uuid !== request.uuid || response.data.status !== 'withdrawn' || !response.data.withdrawnAt)
      throw new Error('The withdrawal response could not be confirmed. Refresh your requests or retry.');
    await queryClient.cancelQueries({ queryKey, exact: true });
    assertSessionEpoch(epoch);
    if (queryClient.getQueryState(queryKey)?.status !== 'success') return;
    queryClient.setQueryData<CompanyAuthorityRequest[]>(queryKey, (previous) =>
      previous?.map((existing) => (existing.uuid === request.uuid ? response.data : existing)),
    );
  };
  return (
    <Page
      testID="company-authority-screen"
      title="Representative authority"
      lede="Representative authority verification is not available yet. Requests grant no company authority."
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
                    setSubmitted(undefined);
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
            onSubmitted={(request) => {
              setSubmitted({ epoch, request });
              void requests.refetch();
            }}
          />
        )}
        {submittedRequest && (
          <Text accessibilityRole="alert" style={styles.text}>
            Your request has been retained. {submittedRequest.verificationMessage}
          </Text>
        )}
      </Section>
      <Section title="Your requests">
        <Text style={styles.muted}>
          Only your own submissions appear here. You can withdraw a pending request. Its history and evidence remain
          retained.
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
              <AuthorityRequestRecord
                key={`${epoch}:${request.uuid}`}
                request={request}
                blocked={requests.isFetching}
                onWithdraw={() => withdraw(request)}
              />
            ))}
          </Rows>
        )}
      </Section>
    </Page>
  );
}
