import { Text } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import type { AxiosResponse } from 'axios';
import { Action } from '../../components/Ledger';
import { EXTENSION_BY_MIME_TYPE, shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { useCompanyStyles } from './styles';

export function RegisterCopy({
  label,
  accessibilityLabel,
  filename,
  epoch,
  read,
}: {
  label: string;
  accessibilityLabel: string;
  filename: string;
  epoch: number;
  read: () => Promise<AxiosResponse<ArrayBuffer>>;
}) {
  const styles = useCompanyStyles();
  const share = useMutation({
    mutationFn: async () => {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await shareDocumentCopy(
        epoch,
        async () => {
          const response = await read();
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return {
            name: `${filename}${EXTENSION_BY_MIME_TYPE[type] || ''}`,
            type,
            bytes: new Uint8Array(response.data),
          };
        },
        (uri, type) => Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] }),
      );
    },
  });
  return (
    <>
      <Action
        label={label}
        accessibilityLabel={accessibilityLabel}
        disabled={share.isPending}
        onPress={() => share.mutate()}
      />
      {share.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          The document could not be opened. Try again.
        </Text>
      )}
    </>
  );
}
