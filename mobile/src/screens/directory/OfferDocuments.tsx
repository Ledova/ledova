import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  OFFER_DOCUMENT_COPY,
  describeOfferDocument,
  downloadDirectoryDocument,
  type DirectoryDocument,
  type useDirectoryDocuments,
} from '@ledova/shared';
import { Action, Rows, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { EXTENSION_BY_MIME_TYPE, shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { getSessionEpoch } from '../../services/sessionScope';
import { useDirectoryStyles } from './DirectoryPage';

const SHARING_UNAVAILABLE = 'Sharing is not available on this device.';

export function OfferDocuments({ token, read }: { token: string; read: ReturnType<typeof useDirectoryDocuments> }) {
  const styles = useDirectoryStyles();
  const [opening, setOpening] = useState<string | undefined>(undefined);
  const [openError, setOpenError] = useState<string | undefined>(undefined);

  const open = async (document: DirectoryDocument) => {
    if (opening) return;
    const epoch = getSessionEpoch();
    setOpening(document.uuid);
    setOpenError(undefined);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        if (epoch === getSessionEpoch()) setOpenError(SHARING_UNAVAILABLE);
        return;
      }
      await shareDocumentCopy(
        epoch,
        async () => {
          const response = await downloadDirectoryDocument(apiClient, token, document.uuid, {
            ledovaSessionEpoch: epoch,
          });
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return {
            name: `${document.uuid}${EXTENSION_BY_MIME_TYPE[type] || ''}`,
            type,
            bytes: new Uint8Array(response.data),
          };
        },
        (uri, type) => Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] }),
      );
    } catch {
      if (epoch === getSessionEpoch()) setOpenError(OFFER_DOCUMENT_COPY.OPEN_FAILED);
    } finally {
      setOpening(undefined);
    }
  };

  return (
    <Section title={OFFER_DOCUMENT_COPY.TITLE}>
      {read.isLoading ? (
        <Text style={styles.help}>{OFFER_DOCUMENT_COPY.LOADING}</Text>
      ) : read.hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.message}>
            {OFFER_DOCUMENT_COPY.FAILED}
          </Text>
          <Action label={OFFER_DOCUMENT_COPY.RETRY} onPress={() => void read.retry()} disabled={read.isRefreshing} />
        </View>
      ) : read.documents.length === 0 ? (
        <Text style={styles.help}>{OFFER_DOCUMENT_COPY.EMPTY}</Text>
      ) : (
        <>
          <Text style={styles.help}>{OFFER_DOCUMENT_COPY.HELP}</Text>
          {openError && (
            <Text accessibilityRole="alert" style={styles.message}>
              {openError}
            </Text>
          )}
          <Rows>
            {read.documents.map((document) => (
              <View key={document.uuid} style={styles.document}>
                <Text style={styles.message}>{document.name}</Text>
                <Text style={styles.help}>{describeOfferDocument(document)}</Text>
                <Action
                  label={opening === document.uuid ? OFFER_DOCUMENT_COPY.OPENING : OFFER_DOCUMENT_COPY.VIEW}
                  accessibilityLabel={`${OFFER_DOCUMENT_COPY.VIEW} ${document.name}`}
                  disabled={opening !== undefined}
                  onPress={() => void open(document)}
                />
              </View>
            ))}
          </Rows>
        </>
      )}
    </Section>
  );
}
