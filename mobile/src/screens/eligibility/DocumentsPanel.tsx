import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  DOCUMENT_TYPE_LABELS,
  FIELD_LIMITS,
  apiErrorSentence,
  attachedClaimLabel,
  documentClaimOptions,
  extractionState,
  formatDate,
  payslipDetails,
  useAttachDocument,
  useDeleteDocument,
  useDocument,
  useErrorSummary,
  useInvestorClassifications,
  useUploadDocument,
  type Document,
  type InvestorClassification,
  type useDocuments,
} from '@ledova/shared';
import { ErrorSummary } from '../../components/ErrorSummary';
import { Action, Actions, Fact, FormActions, Rows, ShowMore, Status } from '../../components/Ledger';
import { SelectField } from '../../components/SelectField';
import { CustomModal } from '../../components/modal';
import { Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { usePickedDocument } from './usePickedDocument';

function useDocumentStyles() {
  return useThemedStyles((theme) => ({
    state: { gap: theme.spacing.smd },
    record: { gap: theme.spacing.smd, paddingVertical: theme.spacing.md },
    top: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd },
    heading: { flex: 1 },
    name: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
    form: { gap: theme.spacing.md },
    upload: {
      gap: theme.spacing.md,
      paddingTop: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    },
    file: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.smd,
      padding: theme.spacing.smd,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
    },
    choose: { fontFamily: theme.fontFamily.regular, fontSize: 16, color: theme.colors.text.primary },
    filename: { flex: 1, fontFamily: theme.fontFamily.regular, fontSize: 16, color: theme.colors.text.muted },
    off: { opacity: 0.5 },
    warning: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.status.warning.text,
    },
  }));
}

function PayslipResult({ extraction }: { extraction: Document['latestExtraction'] }) {
  const look = useDocumentStyles();
  const details = payslipDetails(extraction);
  if (!details) return null;
  return (
    <>
      <ShowMore show="Show extraction details" hide="Hide extraction details">
        <Rows>
          {details.fields.map((field) => (
            <Fact key={field.label} label={field.label}>
              {field.value}
            </Fact>
          ))}
        </Rows>
      </ShowMore>
      {details.warnings.length > 0 && <Text style={look.warning}>{details.warnings.join(' · ')}</Text>}
    </>
  );
}

function DocumentCard({
  initialDoc,
  claims,
  paused,
}: {
  initialDoc: Document;
  claims: InvestorClassification[];
  paused: boolean;
}) {
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const live = useDocument(initialDoc.uuid, { session: orderSubmissionSession, paused });
  const doc = live.data ?? initialDoc;
  const extraction = doc.latestExtraction;
  const state = extractionState(extraction?.status);
  const del = useDeleteDocument(orderSubmissionSession);
  const attach = useAttachDocument(orderSubmissionSession);
  const [classification, setClassification] = useState('');
  const attachment = useErrorSummary({
    classification: !classification && 'Choose the claim to attach this payslip to.',
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = attach.isPending || del.isPending;
  const failure = attach.error || del.error;
  const attachLabel = attach.isPending ? 'Attaching…' : 'Attach to claim';

  return (
    <View style={look.record}>
      <View style={look.top}>
        <View style={look.heading}>
          <Text accessibilityRole="header" style={look.name}>
            {doc.originalFilename}
          </Text>
          <Text style={styles.muted}>
            {DOCUMENT_TYPE_LABELS[doc.documentType]} · {formatDate(doc.createdAt, '—')}
          </Text>
        </View>
        <Status tone={state.tone}>{state.label}</Status>
      </View>
      {doc.classification ? (
        <Rows>
          <Fact label="Classification claim">{attachedClaimLabel(doc.classification, claims)}</Fact>
          <Fact label="Retained">
            {doc.retentionUntil ? `Until ${formatDate(doc.retentionUntil, '—')}` : 'With the claim'}
          </Fact>
        </Rows>
      ) : (
        <View style={look.form}>
          <ErrorSummary {...attachment.summary} />
          <SelectField
            label="Classification claim"
            value={classification}
            options={documentClaimOptions(claims)}
            disabled={busy}
            error={attachment.field('classification').error}
            onChange={setClassification}
          />
          <Text style={styles.muted}>
            Unattached payslips are removed{' '}
            {doc.retentionUntil ? `on ${formatDate(doc.retentionUntil, '—')}` : 'according to the retention policy'}.
          </Text>
          <FormActions>
            <Action
              label="Delete document"
              accessibilityLabel={`Delete document (${doc.originalFilename})`}
              disabled={busy}
              onPress={() => setConfirmingDelete(true)}
            />
            <Action
              label={attachLabel}
              accessibilityLabel={`${attachLabel} (${doc.originalFilename})`}
              primary
              disabled={busy}
              onPress={() => {
                if (attachment.check()) attach.mutate({ uuid: doc.uuid, classification });
              }}
            />
          </FormActions>
        </View>
      )}
      {!!failure && (
        <Text accessibilityRole="alert" style={styles.error}>
          {apiErrorSentence(failure, 'The document could not be updated.')}
        </Text>
      )}
      {confirmingDelete && (
        <CustomModal
          visible
          title="Delete this document?"
          busy={del.isPending}
          onClose={() => setConfirmingDelete(false)}
          actions={
            <Action
              label={del.isPending ? 'Deleting…' : 'Delete document'}
              primary
              disabled={del.isPending}
              onPress={() => del.mutate(doc.uuid, { onSettled: () => setConfirmingDelete(false) })}
            />
          }
        >
          <Text style={styles.text}>{doc.originalFilename} is deleted. This can’t be undone.</Text>
        </CustomModal>
      )}
      <PayslipResult extraction={extraction} />
      {extraction?.status === 'failed' && !!extraction.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {extraction.error}
        </Text>
      )}
    </View>
  );
}

function UploadCard({ claims }: { claims: InvestorClassification[] }) {
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [classification, setClassification] = useState('');
  const picked = usePickedDocument();
  const upload = useUploadDocument();
  const busy = upload.isPending || picked.isPicking;
  const clear = () => {
    picked.remove();
    setNote('');
    setClassification('');
    setOpen(false);
  };
  const submit = () => {
    const file = picked.file;
    if (!file || busy) return;
    upload.mutate(
      {
        file: { uri: file.uri, name: file.name, type: file.type },
        documentType: 'payslip',
        note,
        classification: classification || undefined,
        config: { ledovaSessionEpoch: file.epoch },
      },
      { onSuccess: clear },
    );
  };

  if (!open)
    return (
      <FormActions>
        <Action label="Upload a payslip" onPress={() => setOpen(true)} />
      </FormActions>
    );
  return (
    <View style={look.upload}>
      <Text accessibilityRole="header" style={look.name}>
        Upload a payslip
      </Text>
      <View style={styles.group}>
        <Text style={styles.text}>File</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="File"
          accessibilityValue={picked.file ? { text: picked.file.name } : undefined}
          accessibilityHint={picked.refusal ?? undefined}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void picked.choose()}
          style={[look.file, busy && look.off]}
        >
          <Text style={look.choose}>Choose file</Text>
          {!!picked.file && (
            <Text numberOfLines={1} style={look.filename}>
              {picked.file.name}
            </Text>
          )}
        </Pressable>
        {!!picked.refusal && (
          <Text accessibilityRole="alert" style={styles.error}>
            {picked.refusal}
          </Text>
        )}
      </View>
      <Field label="Note" value={note} maxLength={FIELD_LIMITS.NOTE} editable={!upload.isPending} onChange={setNote} />
      <SelectField
        label="Classification claim"
        value={classification}
        options={documentClaimOptions(claims)}
        disabled={upload.isPending}
        onChange={setClassification}
      />
      {!!upload.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {apiErrorSentence(upload.error, 'The payslip could not be uploaded.')}
        </Text>
      )}
      <FormActions>
        <Action
          label="Cancel"
          accessibilityLabel="Cancel (payslip upload)"
          disabled={busy}
          onPress={() => {
            upload.reset();
            clear();
          }}
        />
        <Action
          label={upload.isPending ? 'Uploading…' : 'Upload and extract'}
          primary
          disabled={!picked.file || busy}
          onPress={submit}
        />
      </FormActions>
    </View>
  );
}

export function DocumentsPanel({ documents }: { documents: ReturnType<typeof useDocuments> }) {
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const focused = useIsFocused();
  const claimsQuery = useInvestorClassifications();
  const claims = claimsQuery.data ?? [];
  const list = documents.data ?? [];

  return (
    <>
      <Text style={styles.muted}>
        Payslips support classification claims for human review; extraction does not establish eligibility. They are
        private to you and permitted platform operations staff. Issuers cannot review them.
      </Text>
      {claimsQuery.isError && (
        <View style={look.state}>
          <Text accessibilityRole="alert" style={styles.text}>
            Your classification claims could not be loaded.
          </Text>
          <Actions>
            <Action label="Try again" disabled={claimsQuery.isFetching} onPress={() => void claimsQuery.refetch()} />
          </Actions>
        </View>
      )}
      {claimsQuery.isSuccess && !claims.some((claim) => claim.status === 'submitted') && (
        <Text style={styles.muted}>Submit a claim before attaching supporting evidence.</Text>
      )}
      {documents.isLoading && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Loading your documents…
        </Text>
      )}
      {documents.isError && (
        <View style={look.state}>
          <Text accessibilityRole="alert" style={styles.text}>
            Your documents could not be loaded.
          </Text>
          <Actions>
            <Action label="Try again" disabled={documents.isFetching} onPress={() => void documents.refetch()} />
          </Actions>
        </View>
      )}
      {documents.isSuccess && list.length === 0 && <Text style={styles.muted}>No documents yet.</Text>}
      {list.length > 0 && (
        <Rows>
          {list.map((doc) => (
            <DocumentCard key={doc.uuid} initialDoc={doc} claims={claims} paused={!focused} />
          ))}
        </Rows>
      )}
      <UploadCard claims={claims} />
    </>
  );
}
