import { useState, useSyncExternalStore } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  admitCompanyAuthorityRequest,
  getCompanies,
  getCompanyAuthorityRequests,
  readEveryPage,
  revokeCompanyAuthorityAppointment,
  withdrawCompanyAuthorityRequest,
  type CompanyAuthorityRequest,
} from '@ledova/shared';
import { Action, Choice, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { useCompanyStyles } from '../company-register/styles';
import { importAppointmentsKey } from '../company-register/useCompanyRegister';
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
  const changeRequest = async (request: CompanyAuthorityRequest, action: 'withdraw' | 'admit' | 'revoke') => {
    const queryKey = ['company-authority-requests', epoch];
    assertSessionEpoch(epoch);
    await queryClient.cancelQueries({ queryKey, exact: true });
    assertSessionEpoch(epoch);
    const send =
      action === 'admit'
        ? admitCompanyAuthorityRequest
        : action === 'revoke'
          ? revokeCompanyAuthorityAppointment
          : withdrawCompanyAuthorityRequest;
    const response = await send(apiClient, request.uuid, { ledovaSessionEpoch: epoch });
    assertSessionEpoch(epoch);
    if (
      response.data.uuid !== request.uuid ||
      (action === 'withdraw' && (response.data.status !== 'withdrawn' || !response.data.withdrawnAt)) ||
      (action === 'admit' && (response.data.status !== 'admitted' || !response.data.appointment)) ||
      (action === 'revoke' &&
        (response.data.status !== 'admitted' ||
          response.data.appointment?.status !== 'revoked' ||
          !response.data.appointment.revokedAt))
    )
      throw new Error('The request outcome could not be confirmed. Refresh your requests or retry.');
    if (action === 'revoke') void queryClient.invalidateQueries({ queryKey: importAppointmentsKey(epoch) });
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
      lede="Establish your representative appointment by accepting an authorisation declaration. Company information is provided by the company. Submitting evidence alone grants no authority."
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
          Only your own submissions appear here. You can admit or withdraw a pending request and revoke your own
          appointment. History and evidence remain retained.
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
                onWithdraw={() => changeRequest(request, 'withdraw')}
                onAdmit={() => changeRequest(request, 'admit')}
                onRevoke={() => changeRequest(request, 'revoke')}
              />
            ))}
          </Rows>
        )}
      </Section>
    </Page>
  );
}
