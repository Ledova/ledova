import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { formatDate, getErrorMessage, type CompanyDocument } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { EXTENSION_BY_MIME_TYPE, shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { useCompanyStyles } from '../company-register/styles';
import type { CompanyActionRead } from './CompanyState';

export function DocumentEntry({
  document,
  removable,
  editable,
  onRemove,
  read,
  companyUuid,
}: {
  document: CompanyDocument;
  removable: boolean;
  editable: boolean;
  onRemove: () => void;
  read: CompanyActionRead;
  companyUuid: string;
}) {
  const styles = useCompanyStyles();
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  const pending = useRef(false);
  const client = useQueryClient();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const guard = () => {
    if (!mounted.current) throw new Error('This document is no longer open.');
    read.assertCurrent(companyUuid);
    const company = client.getQueryData<NonNullable<typeof read.company>>(read.companyKey);
    if (
      !company?.documents.some(
        (item) => item.uuid === document.uuid && item.company === companyUuid && item.fileUrl === document.fileUrl,
      )
    )
      throw new Error('This document is no longer available for this company.');
  };
  const open = async () => {
    if (!document.fileUrl || pending.current) return;
    pending.current = true;
    const epoch = getSessionEpoch();
    setOpening(true);
    try {
      guard();
      if (document.company !== companyUuid) throw new Error('This document belongs to another company.');
      if (!(await Sharing.isAvailableAsync())) {
        if (epoch === getSessionEpoch())
          Alert.alert('Cannot open document', 'Sharing is not available on this device.');
        return;
      }
      await shareDocumentCopy(
        epoch,
        async () => {
          guard();
          const response = await apiClient.get<ArrayBuffer>(document.fileUrl!, {
            ...read.requestConfig(companyUuid),
            ledovaSubmissionGuard: guard,
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
          });
          guard();
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return {
            name: `${document.uuid}${EXTENSION_BY_MIME_TYPE[type] || ''}`,
            type,
            bytes: new Uint8Array(response.data),
          };
        },
        (uri, type) => {
          guard();
          return Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] });
        },
      );
    } catch (error) {
      if (mounted.current && epoch === getSessionEpoch())
        Alert.alert('Cannot open document', getErrorMessage(error) || 'The document could not be opened.');
    } finally {
      pending.current = false;
      if (mounted.current) setOpening(false);
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
          disabled={opening || !!read.error || read.isRefreshing || !read.canAdmin}
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
