import { useState } from 'react';
import { Text, TextInput, View, ScrollView, RefreshControl } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  OPTIONAL_DOCUMENTS,
  REQUIRED_DOCUMENTS,
  formatDate,
  getErrorMessage,
  getOperator,
  type CompanyDocument,
  type DocumentType,
} from '@ledova/shared';
import type { BottomTabParamList } from '../../navigation/BottomTabNavigator';
import { Action, Row, Section } from '../../components/Ledger';
import { CompanyModal } from '../company/CompanyModal';
import { apiClient } from '../../services/apiClient';
import { CompanyReadNotice } from '../company/CompanyState';
import { useCompanyStyles } from '../company-register/styles';
import { CompanyUpload } from './CompanyUpload';
import { DocumentEntry } from './DocumentEntry';
import { useCompanyDocuments } from './useCompanyDocuments';

const ACTION_ERROR = 'The request was refused. Please try again.';

export function ListingScreen() {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<BottomTabParamList>>();
  const data = useCompanyDocuments();
  const { company, documents, canEdit, deletion, submission, resubmission, withdrawal } = data;
  const [upload, setUpload] = useState<{ company: string; type: DocumentType; label: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [removing, setRemoving] = useState<{ company: string; document: CompanyDocument } | null>(null);
  const [response, setResponse] = useState('');
  const [responseCompany, setResponseCompany] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const operator = useQuery({
    queryKey: ['operator'],
    queryFn: () => getOperator(apiClient),
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
    enabled: data.access.allowed,
  });
  const operatorName = operator.isError ? 'The operator' : operator.data?.data.name || 'The operator';
  const busy = deletion.isPending || submission.isPending || resubmission.isPending || withdrawal.isPending;
  const ready = !!company && !data.error && !data.isRefreshing;
  const canWithdraw = company?.status === 'submitted' || company?.status === 'info_required';
  const missing = REQUIRED_DOCUMENTS.filter(
    ({ type }) => !documents.some((document) => document.documentType === type),
  );
  const canSubmit = ready && company.status === 'draft' && missing.length === 0 && !busy;
  const canResubmit =
    ready &&
    company.status === 'info_required' &&
    missing.length === 0 &&
    responseCompany === company.uuid &&
    response.trim() !== '' &&
    !busy;
  const events = company
    ? [
        ['Submitted', company.submittedAt],
        ['Review started', company.reviewStartedAt],
        ['Information requested', company.infoRequestedAt],
        ['Approved', company.approvedAt],
        ['Activated', company.activatedAt],
        ['Rejected', company.rejectionAt],
        ['Withdrawn', company.withdrawnAt],
      ]
        .flatMap(([label, at]) => (at ? [{ label: label!, at }] : []))
        .sort((a, b) => a.at.localeCompare(b.at))
    : [];
  const submit = async () => {
    if (!canSubmit) return;
    setActionError(null);
    try {
      await submission.mutateAsync(company.uuid);
    } catch (error) {
      setActionError(getErrorMessage(error, ACTION_ERROR));
    }
  };
  const resubmit = async () => {
    if (!canResubmit) return;
    setActionError(null);
    try {
      await resubmission.mutateAsync({ companyUuid: company.uuid, response: response.trim() });
      setResponse('');
      setResponseCompany(null);
    } catch (error) {
      setActionError(getErrorMessage(error, ACTION_ERROR));
    }
  };
  const withdraw = async () => {
    if (!ready || !canWithdraw || !withdrawing || company.uuid !== withdrawing || busy) return;
    try {
      await withdrawal.mutateAsync({ companyUuid: withdrawing, reason: withdrawReason.trim() });
      setWithdrawing(null);
      setWithdrawReason('');
    } catch {}
  };
  const remove = async () => {
    if (!ready || !canEdit || !removing || company.uuid !== removing.company || busy) return;
    try {
      await deletion.mutateAsync({ companyUuid: removing.company, documentUuid: removing.document.uuid });
      setRemoving(null);
    } catch {}
  };
  const documentSection = (title: string, types: { type: DocumentType; label: string }[], required: boolean) => (
    <Section title={title}>
      {types.map(({ type, label }) => {
        const matches = documents.filter((document) => document.documentType === type);
        return (
          <View key={type} style={styles.entry}>
            <Text style={styles.heading}>{label}</Text>
            <Text style={styles.muted}>{matches.length ? 'Uploaded' : required ? 'Required' : 'Optional'}</Text>
            {matches.map((document) => (
              <DocumentEntry
                key={document.uuid}
                document={document}
                editable={canEdit}
                removable={ready && !busy}
                onRemove={() => {
                  deletion.reset();
                  setRemoving({ company: company!.uuid, document });
                }}
              />
            ))}
            {canEdit && matches.length === 0 && type !== 'other' && (
              <Action
                label={`Upload ${label}`}
                disabled={!ready || busy}
                onPress={() => setUpload({ company: company!.uuid, type, label })}
              />
            )}
          </View>
        );
      })}
    </Section>
  );
  if (!data.access.allowed)
    return (
      <View style={[styles.page, styles.content]}>
        <Text style={styles.muted}>
          {data.access.isLoading
            ? 'Loading your company access…'
            : 'Verify your company access before opening Application.'}
        </Text>
        {data.access.isError && <Action label="Retry company access" onPress={() => void data.access.refetch()} />}
      </View>
    );
  return (
    <>
      <ScrollView
        testID="application-screen"
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={data.isRefreshing} onRefresh={() => void data.refetch()} />}
      >
        <Text accessibilityRole="header" style={styles.title}>
          Application
        </Text>
        <Action label="Back to Company" onPress={() => navigation.navigate('Company', { screen: 'CompanyDetails' })} />
        {data.isLoading ? (
          <Text style={styles.muted}>Loading company information…</Text>
        ) : data.error ? (
          <CompanyReadNotice read={data} />
        ) : !company ? (
          <Text style={styles.muted}>No company found. Please register your company first.</Text>
        ) : (
          <>
            <Section title="Application record">
              <Text style={styles.heading}>{company.name}</Text>
              <Row label="Status">{company.statusDisplay}</Row>
              {events.map(({ label, at }) => (
                <Row key={label} label={label}>
                  {formatDate(at)}
                </Row>
              ))}
              {company.status === 'submitted' && (
                <Text style={styles.muted}>Your application is waiting for {operatorName} to start the review.</Text>
              )}
              {company.status === 'review' && (
                <Text style={styles.muted}>
                  {operatorName} is reviewing your application. Withdrawal is no longer available once review has
                  started.
                </Text>
              )}
              {!!company.rejectionReason && (
                <Text style={styles.muted}>Rejection reason: {company.rejectionReason}</Text>
              )}
              {!!company.withdrawalReason && (
                <Text style={styles.muted}>Withdrawal reason: {company.withdrawalReason}</Text>
              )}
              {!!company.infoRequestReason && (
                <View style={styles.group}>
                  <Text style={styles.heading}>Information requested</Text>
                  <Text style={styles.text}>{company.infoRequestReason}</Text>
                </View>
              )}
              {!!company.additionalInfoResponse && (
                <View style={styles.group}>
                  <Text style={styles.heading}>Your previous response</Text>
                  <Text style={styles.text}>{company.additionalInfoResponse}</Text>
                </View>
              )}
              {canWithdraw && (
                <Action
                  label="Withdraw application"
                  disabled={!ready || busy}
                  onPress={() => {
                    withdrawal.reset();
                    setWithdrawing(company.uuid);
                    setWithdrawReason('');
                  }}
                />
              )}
            </Section>
            {documentSection('Required documents', REQUIRED_DOCUMENTS, true)}
            {documentSection('Optional documents', OPTIONAL_DOCUMENTS, false)}
            {company.status === 'info_required' && (
              <Section title="Your response">
                <Text style={styles.muted}>
                  Answer the request, upload the documents it asks for, then resubmit your application.
                </Text>
                <Text style={styles.text}>Response to the operator</Text>
                <TextInput
                  accessibilityLabel="Response to the operator"
                  style={styles.input}
                  multiline
                  value={response}
                  editable={!busy}
                  onChangeText={(value) => {
                    setResponseCompany(company.uuid);
                    setResponse(value);
                  }}
                />
                {responseCompany && responseCompany !== company.uuid && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    This response belongs to another company. Edit it before continuing.
                  </Text>
                )}
                {actionError && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {actionError}
                  </Text>
                )}
                <Action
                  label={resubmission.isPending ? 'Resubmitting…' : 'Resubmit application'}
                  primary
                  disabled={!canResubmit}
                  onPress={() => void resubmit()}
                />
              </Section>
            )}
            {company.status === 'draft' && (
              <View style={styles.group}>
                {actionError && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {actionError}
                  </Text>
                )}
                <Action
                  label={submission.isPending ? 'Submitting…' : 'Submit application'}
                  primary
                  disabled={!canSubmit}
                  onPress={() => void submit()}
                />
              </View>
            )}
            {canEdit && missing.length > 0 && (
              <Text style={styles.muted}>
                {missing.length} required document{missing.length === 1 ? '' : 's'} still missing.
              </Text>
            )}
            <Section title="What happens next">
              <Text style={styles.muted}>
                {operatorName} reviews the application and may request more information. Approval and activation are
                separate decisions. Share classes can be deployed once the company is active.
              </Text>
              {operator.isError && (
                <View style={styles.group}>
                  <Text accessibilityRole="alert" style={styles.error}>
                    Operator details could not be loaded.
                  </Text>
                  <Action
                    label="Retry operator details"
                    disabled={operator.isFetching}
                    onPress={() => void operator.refetch()}
                  />
                </View>
              )}
            </Section>
          </>
        )}
      </ScrollView>
      {withdrawing && (
        <CompanyModal
          onClose={() => {
            if (!withdrawal.isPending) setWithdrawing(null);
          }}
        >
          <View style={styles.group}>
            <Text accessibilityRole="header" style={styles.heading}>
              Withdraw application
            </Text>
            <CompanyReadNotice read={data} />
            {(!canWithdraw || company?.uuid !== withdrawing) && !data.error && !data.isRefreshing && (
              <Text accessibilityRole="alert" style={styles.error}>
                This application can no longer be withdrawn.
              </Text>
            )}
            <Text style={styles.muted}>
              Withdrawal takes the application out of the review queue. You will need to register again to apply later.
            </Text>
            {withdrawal.isError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {getErrorMessage(withdrawal.error, ACTION_ERROR)}
              </Text>
            )}
            <Text style={styles.text}>Reason (optional)</Text>
            <TextInput
              accessibilityLabel="Reason (optional)"
              style={styles.input}
              multiline
              value={withdrawReason}
              onChangeText={setWithdrawReason}
              editable={!withdrawal.isPending}
            />
            <Action
              label="Confirm withdrawal"
              disabled={!ready || !canWithdraw || company?.uuid !== withdrawing || busy}
              onPress={() => void withdraw()}
            />
            <Action label="Cancel" disabled={withdrawal.isPending} onPress={() => setWithdrawing(null)} />
          </View>
        </CompanyModal>
      )}
      {removing && (
        <CompanyModal
          onClose={() => {
            if (!deletion.isPending) setRemoving(null);
          }}
        >
          <View style={styles.group}>
            <Text accessibilityRole="header" style={styles.heading}>
              Remove document
            </Text>
            <Text style={styles.text}>{removing.document.name}</Text>
            <CompanyReadNotice read={data} />
            {deletion.isError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {getErrorMessage(deletion.error, ACTION_ERROR)}
              </Text>
            )}
            <Action
              label="Confirm removal"
              disabled={!ready || !canEdit || company?.uuid !== removing.company || busy}
              onPress={() => void remove()}
            />
            <Action label="Cancel" disabled={deletion.isPending} onPress={() => setRemoving(null)} />
          </View>
        </CompanyModal>
      )}
      {upload && (
        <CompanyUpload
          companyUuid={upload.company}
          type={upload.type}
          label={upload.label}
          canUpload={company?.uuid === upload.company && canEdit}
          read={data}
          upload={data.upload}
          onClose={() => setUpload(null)}
        />
      )}
    </>
  );
}
