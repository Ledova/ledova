import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  canPrepareCertificate,
  formatDate,
  formatDateTime,
  formatRegisterChanges,
  useClassCertificate,
  type ClassCertificateSource,
} from '@ledova/shared';
import { Action, Actions, Fact, FormActions, Outcome, Rows } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useDocumentStyles } from './useDocumentStyles';

type Editing = { onEditingChange: (entry: string, open: boolean) => void };

export function ClassCertificate({
  sourceKey,
  onEditingChange,
  ...source
}: ClassCertificateSource & Editing & { sourceKey: string }) {
  if (!canPrepareCertificate(source.entry)) return null;
  return (
    <CertificateRequest
      key={JSON.stringify([source.register, source.entry, sourceKey, source.sourceReady])}
      {...source}
      onEditingChange={onEditingChange}
    />
  );
}

function CertificateRequest({ onEditingChange, ...source }: ClassCertificateSource & Editing) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onEditingChange(source.entry.uuid, open);
    return () => onEditingChange(source.entry.uuid, false);
  }, [onEditingChange, open, source.entry.uuid]);
  return open ? (
    <CertificateForm {...source} close={() => setOpen(false)} />
  ) : (
    <Actions>
      <Action
        compact
        label="Prepare certificate"
        accessibilityLabel={`Prepare certificate (entry ${source.entry.sequence})`}
        disabled={!source.sourceReady || !source.register.initialized}
        onPress={() => setOpen(true)}
      />
    </Actions>
  );
}

function CertificateForm({
  register,
  entry,
  guard,
  sourceReady,
  close,
}: ClassCertificateSource & { close: () => void }) {
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const { target, busy, error, downloaded, blocked, preview, download } = useClassCertificate({
    register,
    entry,
    guard,
    sourceReady,
    files: SHARE_SHEET_FILES,
    session: orderSubmissionSession,
  });
  const context = `unsigned certificate for entry ${entry.sequence}`;
  const action = target
    ? busy === 'download'
      ? 'Downloading…'
      : 'Download PDF'
    : busy === 'preview'
      ? 'Preparing preview…'
      : 'Preview';
  return (
    <View style={look.form}>
      <Text accessibilityRole="header" style={look.heading}>
        Unsigned certificate
      </Text>
      <Rows>
        <Fact label="Share movements">{formatRegisterChanges(entry.changes).join('\n')}</Fact>
        <Fact label="Company date">{formatDate(entry.companyEventOn, 'Not recorded')}</Fact>
        <Fact label="Entry">{String(entry.sequence)}</Fact>
        <Fact label="Ledger date">{formatDate(entry.effectiveOn)}</Fact>
        <Fact label="Recorded on">{formatDateTime(entry.recordedAt)}</Fact>
        {target && <Fact label="PDF pages">{String(target.preview.pageCount)}</Fact>}
      </Rows>
      <Text style={styles.muted}>Includes names and residential addresses. The company arranges signing.</Text>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {downloaded && <Outcome>The unsigned certificate was downloaded.</Outcome>}
      <FormActions>
        <Action label="Cancel" accessibilityLabel={`Cancel (${context})`} disabled={!!busy} onPress={close} />
        <Action
          key={target ? 'download' : 'preview'}
          primary
          label={action}
          accessibilityLabel={`${action} (${context})`}
          disabled={blocked}
          onPress={() => void (target ? download() : preview())}
        />
      </FormActions>
    </View>
  );
}
