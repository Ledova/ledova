import { useState } from 'react';
import { Text, View } from 'react-native';
import { getErrorMessage, type DocumentType } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useDocumentUpload } from '../../hooks/useDocumentUpload';
import { getSessionEpoch } from '../../services/sessionScope';
import { CompanyReadNotice, type CompanyRead } from '../company/CompanyState';
import { useCompanyStyles } from '../company-register/styles';
import type { useCompanyDocuments } from './useCompanyDocuments';

export function CompanyUpload({
  companyUuid,
  type,
  label,
  canUpload,
  read,
  upload,
  onClose,
}: {
  companyUuid: string;
  type: DocumentType;
  label: string;
  canUpload: boolean;
  read: CompanyRead;
  upload: ReturnType<typeof useCompanyDocuments>['upload'];
  onClose: () => void;
}) {
  const styles = useCompanyStyles();
  const document = useDocumentUpload(companyUuid);
  const [error, setError] = useState<string | null>(null);
  const busy = document.isPicking || document.isSubmitting;
  const valid = !!document.file && canUpload && !read.error && !read.isRefreshing && !busy;
  const close = () => {
    if (!busy) onClose();
  };
  const pick = async () => {
    setError(null);
    const epoch = getSessionEpoch();
    try {
      await document.pick();
    } catch (error) {
      if (epoch === getSessionEpoch())
        setError(getErrorMessage(error, 'The document could not be selected. Try again.'));
    }
  };
  const submit = async () => {
    if (!valid) return;
    setError(null);
    const epoch = getSessionEpoch();
    try {
      const completed = await document.submit(({ file, owner, sessionEpoch }) =>
        upload({ file, name: file.name, documentType: type, companyUuid: owner, sessionEpoch }),
      );
      if (completed) onClose();
    } catch (error) {
      if (epoch === getSessionEpoch())
        setError(getErrorMessage(error, 'The document could not be uploaded. Try again.'));
    }
  };
  return (
    <CustomModal
      visible
      title={`Upload ${label}`}
      onClose={close}
      busy={busy}
      actions={
        <Action
          label={document.isSubmitting ? 'Uploading…' : 'Upload document'}
          primary
          disabled={!valid}
          onPress={() => void submit()}
        />
      }
    >
      <View style={styles.group}>
        <CompanyReadNotice read={read} />
        {!canUpload && (
          <Text accessibilityRole="alert" style={styles.error}>
            Documents can no longer be changed for this application.
          </Text>
        )}
        <Text style={styles.muted}>PDF or image, max 10 MB.</Text>
        {document.file ? (
          <>
            <Text style={styles.text}>{document.file.name}</Text>
            <Action label="Remove selected file" disabled={busy} onPress={document.clear} />
          </>
        ) : (
          <Action label="Choose document" disabled={busy} onPress={() => void pick()} />
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
    </CustomModal>
  );
}
