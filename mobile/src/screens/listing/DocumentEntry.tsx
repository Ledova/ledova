import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { formatDate, getErrorMessage, type CompanyDocument } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { useCompanyStyles } from '../company-register/styles';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export function DocumentEntry({
  document,
  removable,
  editable,
  onRemove,
}: {
  document: CompanyDocument;
  removable: boolean;
  editable: boolean;
  onRemove: () => void;
}) {
  const styles = useCompanyStyles();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (!document.fileUrl || opening) return;
    const epoch = getSessionEpoch();
    setOpening(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        if (epoch === getSessionEpoch())
          Alert.alert('Cannot open document', 'Sharing is not available on this device.');
        return;
      }
      await shareDocumentCopy(
        epoch,
        async () => {
          const response = await apiClient.get<ArrayBuffer>(document.fileUrl!, {
            responseType: 'arraybuffer',
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
    } catch (error) {
      if (epoch === getSessionEpoch())
        Alert.alert('Cannot open document', getErrorMessage(error) || 'The document could not be opened.');
    } finally {
      setOpening(false);
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{document.name}</Text>
      <Text style={styles.muted}>
        Uploaded {formatDate(document.createdAt)} · {document.isVerified ? 'Verified' : 'Not verified'}
      </Text>
      {!!document.fileUrl && (
        <Action
          label="View"
          accessibilityLabel={`View ${document.name}`}
          disabled={opening}
          onPress={() => void open()}
        />
      )}
      {editable && (
        <Action
          label="Remove"
          accessibilityLabel={`Remove ${document.name}`}
          disabled={!removable}
          onPress={onRemove}
        />
      )}
    </View>
  );
}
