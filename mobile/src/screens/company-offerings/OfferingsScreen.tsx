import { useEffect, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  OFFERING_EXEMPTION_LABELS,
  OFFERING_PUBLISHED_STATUSES,
  OFFERING_WITHDRAWABLE_STATUSES,
  OFFER_DOCUMENT_COPY,
  apiErrorSentence,
  formatDate,
  formatMoney,
  formatShareCount,
  updateCompany,
  type OfferingListItem,
} from '@ledova/shared';
import { Action, Row, Rows, Section, SwitchRow } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import { CompanyReadNotice } from '../company/CompanyState';
import { CompanySelection } from '../company/CompanySelection';
import { useCompanyStyles } from '../company-register/styles';
import { useOfferingActions, useOfferings } from './useOfferings';
import { OfferingReadNotice } from './OfferingReadNotice';
import { OfferingDocumentsEditor } from './OfferingDocumentsEditor';
import { OfferingEditor } from './OfferingEditor';
import { SubscriptionsLedger } from './SubscriptionsLedger';

function OfferingRecord({
  row,
  busy,
  run,
  edit,
  addDocuments,
  error,
}: {
  row: OfferingListItem;
  busy: boolean;
  run: (action: 'submit' | 'withdraw' | 'remove', uuid: string) => void;
  edit: () => void;
  addDocuments: () => void;
  error?: string;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>
        {row.tokenName} ({row.tokenSymbol})
      </Text>
      <Rows>
        <Row label="Status">{row.statusDisplay}</Row>
        <Row label="Price per share">{formatMoney(row.pricePerShare, row.priceCurrency)}</Row>
        <Row label="Minimum shares">{formatShareCount(String(row.minimumShares))}</Row>
        <Row label="Target shares">{formatShareCount(String(row.targetShares))}</Row>
        <Row label="Cap shares">{formatShareCount(String(row.capShares))}</Row>
        {row.maximumShares !== null && (
          <Row label="Maximum per investor">{formatShareCount(String(row.maximumShares))}</Row>
        )}
        <Row label="Opens">{formatDate(row.opensAt)}</Row>
        <Row label="Closes">{row.closesAt ? formatDate(row.closesAt) : 'No closing date'}</Row>
        <Row label="Exemption">{OFFERING_EXEMPTION_LABELS[row.exemption] ?? row.exemptionDisplay}</Row>
      </Rows>
      {row.status === 'rejected' && !!row.rejectionReason && (
        <Text style={styles.muted}>Rejected: {row.rejectionReason}</Text>
      )}
      {row.status === 'withdrawn' && !!row.rejectionReason && (
        <Text style={styles.muted}>Previous rejection: {row.rejectionReason}</Text>
      )}
      {!!row.closeReason && <Text style={styles.muted}>Closed: {row.closeReason}</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {row.canBeEdited && (
        <>
          <Action
            label={row.status === 'rejected' ? 'Submit again' : 'Submit for review'}
            accessibilityLabel={`${row.status === 'rejected' ? 'Submit again' : 'Submit for review'} ${row.tokenName}`}
            disabled={busy}
            onPress={() => run('submit', row.uuid)}
          />
          <Action label="Edit" accessibilityLabel={`Edit ${row.tokenName} offering`} disabled={busy} onPress={edit} />
        </>
      )}
      {OFFERING_WITHDRAWABLE_STATUSES.includes(row.status) && (
        <Action
          label="Withdraw"
          accessibilityLabel={`Withdraw ${row.tokenName} offering`}
          disabled={busy}
          onPress={() => run('withdraw', row.uuid)}
        />
      )}
      {row.canBeDeleted && (
        <Action
          label="Delete"
          accessibilityLabel={`Delete ${row.tokenName} offering`}
          disabled={busy}
          onPress={() => run('remove', row.uuid)}
        />
      )}
      {OFFERING_PUBLISHED_STATUSES.includes(row.status) && (
        <Action
          label={OFFER_DOCUMENT_COPY.ADD}
          accessibilityLabel={`${OFFER_DOCUMENT_COPY.ADD} to the ${row.tokenName} offering`}
          disabled={busy}
          onPress={addDocuments}
        />
      )}
    </View>
  );
}

export function OfferingsScreen() {
  const companyRead = useCompanyProfile({ ownedOnly: true });
  return <OfferingDetails key={`${companyRead.scopeKey}:${companyRead.companyUuid ?? ''}`} companyRead={companyRead} />;
}

function OfferingDetails({ companyRead }: { companyRead: ReturnType<typeof useCompanyProfile> }) {
  const styles = useCompanyStyles();
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const { company } = companyRead;
  const data = useOfferings(companyRead);
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ company: string; uuid?: string } | null>(null);
  const [documentsEditor, setDocumentsEditor] = useState<{ company: string; uuid: string } | null>(null);
  const [actionError, setActionError] = useState<{ uuid: string | null; message: string } | null>(null);
  const actions = useOfferingActions(companyRead, data.refresh);
  const listing = useMutation({
    mutationFn: async ({
      uuid,
      isOpen,
      guard,
      config,
    }: {
      uuid: string;
      isOpen: boolean;
      guard: () => void;
      config: ReturnType<typeof companyRead.requestConfig>;
    }) => {
      guard();
      const response = await updateCompany(apiClient, uuid, { isOpenToInvestors: isOpen }, config);
      guard();
      if (
        response.data.uuid !== uuid ||
        !Array.isArray(response.data.documents) ||
        response.data.isOpenToInvestors !== isOpen
      )
        throw new Error('Directory visibility could not be confirmed. Refresh before retrying.');
      return response;
    },
    onSuccess: async (_, { guard }) => {
      guard();
      await client.invalidateQueries({ queryKey: companyRead.companyKey });
      guard();
    },
    onMutate: () => setActionError(null),
    onError: (error) =>
      mounted.current &&
      setActionError({
        uuid: null,
        message: apiErrorSentence(error, 'Directory visibility could not be changed. Try again.'),
      }),
    onSettled: () => {
      pending.current = false;
    },
  });
  const busy = actions.submit.isPending || actions.withdraw.isPending || actions.remove.isPending || listing.isPending;
  const ready =
    companyRead.ownerBusiness &&
    !!company &&
    !companyRead.error &&
    !companyRead.isRefreshing &&
    !data.error &&
    !data.isRefreshing &&
    !busy;
  const run = async (action: 'submit' | 'withdraw' | 'remove', uuid: string) => {
    const offering = data.offerings.find((row) => row.uuid === uuid);
    if (!ready || !offering || pending.current || !mounted.current) return;
    if (action === 'submit' && !offering.canBeEdited) return;
    if (action === 'remove' && !offering.canBeDeleted) return;
    if (action === 'withdraw' && !OFFERING_WITHDRAWABLE_STATUSES.includes(offering.status)) return;
    pending.current = true;
    const epoch = getSessionEpoch();
    setActionError(null);
    try {
      if (action === 'withdraw') await actions.withdraw.mutateAsync({ uuid, reason: 'Withdrawn by the issuer', epoch });
      else await actions[action].mutateAsync({ uuid, epoch });
    } catch (error) {
      if (epoch !== getSessionEpoch()) return;
      setActionError({ uuid, message: apiErrorSentence(error, 'The request could not be completed. Try again.') });
    } finally {
      pending.current = false;
    }
  };
  const refresh = async () => {
    await companyRead.refetch();
    return Promise.all([
      data.refetch(),
      client.invalidateQueries({ queryKey: ['offering'] }),
      client.invalidateQueries({ queryKey: ['offering-subscriptions'] }),
    ]);
  };
  if (!companyRead.access.allowed)
    return (
      <Page title="Offerings">
        <Text style={styles.muted}>
          {companyRead.access.isLoading
            ? 'Loading your company access…'
            : 'Verify your company access before opening Offerings.'}
        </Text>
        {companyRead.access.isError && (
          <Action label="Retry company access" onPress={() => void companyRead.access.refetch()} />
        )}
      </Page>
    );
  return (
    <>
      <Page
        testID="offerings-screen"
        title="Offerings"
        actions={
          <Action
            label="New offering"
            disabled={!ready || !data.tokens.some((token) => token.status === 'deployed')}
            onPress={() => {
              if (ready) setEditor({ company: company.uuid });
            }}
          />
        }
        refreshControl={
          <RefreshControl refreshing={companyRead.isRefreshing || data.isRefreshing} onRefresh={() => void refresh()} />
        }
      >
        <CompanySelection read={companyRead} />
        {companyRead.isLoading || data.isLoading ? (
          <Text style={styles.muted}>Loading offering information…</Text>
        ) : companyRead.error ? (
          <CompanyReadNotice read={companyRead} />
        ) : !company ? (
          <Text style={styles.muted}>No company found. Please register your company first.</Text>
        ) : (
          <>
            <CompanyReadNotice read={companyRead} />
            <OfferingReadNotice read={data} />
            {!data.error && (
              <>
                <Section title={`Your offerings (${data.offerings.length})`}>
                  {data.offerings.length === 0 ? (
                    <Text style={styles.muted}>You have no offerings yet. Create one and submit it for review.</Text>
                  ) : (
                    data.offerings.map((row) => (
                      <OfferingRecord
                        key={row.uuid}
                        row={row}
                        error={actionError?.uuid === row.uuid ? actionError.message : undefined}
                        busy={!ready}
                        run={(action, uuid) => void run(action, uuid)}
                        edit={() => {
                          if (ready) setEditor({ company: company.uuid, uuid: row.uuid });
                        }}
                        addDocuments={() => {
                          if (ready) setDocumentsEditor({ company: company.uuid, uuid: row.uuid });
                        }}
                      />
                    ))
                  )}
                  {!data.tokens.some((token) => token.status === 'deployed') && (
                    <Text style={styles.muted}>
                      Deploy a share class before you offer it. An offering names one deployed share class and the
                      shares it may issue against it.
                    </Text>
                  )}
                </Section>
                <SubscriptionsLedger
                  offerings={data.offerings}
                  operatorName={data.operatorName}
                  companyRead={companyRead}
                />
              </>
            )}
            <Section title="Investor Directory">
              <Text style={styles.muted}>
                Your company is listed in the investor directory only while this is on. Nothing is listed by default,
                and {data.operatorName} can switch it off. Turning it off hides your share classes; it does not withdraw
                an offering already under review.
              </Text>
              <SwitchRow
                label="Show this company to eligible investors"
                checked={company.isOpenToInvestors ?? false}
                disabled={!ready || !companyRead.canAdmin || !company.canIssueTokens}
                onChange={(isOpen) => {
                  if (!ready || !companyRead.canAdmin || !company.canIssueTokens || pending.current) return;
                  const authority = companyRead.assertCurrent;
                  const guard = () => {
                    if (!mounted.current) throw new Error('This company view is no longer open.');
                    authority(company.uuid);
                  };
                  pending.current = true;
                  listing.mutate({
                    uuid: company.uuid,
                    isOpen,
                    guard,
                    config: { ...companyRead.requestConfig(company.uuid), ledovaSubmissionGuard: guard },
                  });
                }}
              />
              {!company.canIssueTokens && (
                <Text style={styles.muted}>
                  Your company must be active before it can be listed. It is currently {company.statusDisplay}.
                </Text>
              )}
              {actionError && actionError.uuid === null && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {actionError.message}
                </Text>
              )}
            </Section>
            <Section title="What happens next">
              <Text style={styles.muted}>
                Submit the offering; {data.operatorName} reviews the bounds, the window and the exemption relied on.
              </Text>
              <Text style={styles.muted}>Once approved, it opens automatically at the opening time you set.</Text>
              <Text style={styles.muted}>Eligible investors see it in the directory and can subscribe.</Text>
              <Text style={styles.muted}>
                It closes only when {data.operatorName} closes it; reaching the cap does not close it on its own.
              </Text>
            </Section>
          </>
        )}
      </Page>
      {editor && (
        <OfferingEditor
          key={`${editor.company}:${editor.uuid ?? 'new'}`}
          uuid={editor.uuid}
          targetCompany={editor.company}
          company={company}
          companyRead={companyRead}
          data={data}
          onClose={() => setEditor(null)}
        />
      )}
      {documentsEditor && (
        <OfferingDocumentsEditor
          key={`${documentsEditor.company}:${documentsEditor.uuid}`}
          uuid={documentsEditor.uuid}
          targetCompany={documentsEditor.company}
          company={company}
          companyRead={companyRead}
          refresh={data.refresh}
          onClose={() => setDocumentsEditor(null)}
        />
      )}
    </>
  );
}
