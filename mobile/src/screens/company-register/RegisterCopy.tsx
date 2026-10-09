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
  guard,
}: {
  label: string;
  accessibilityLabel: string;
  filename: string;
  epoch: number;
  read: () => Promise<AxiosResponse<ArrayBuffer>>;
  guard?: () => void;
}) {
  const styles = useCompanyStyles();
  const share = useMutation({
    mutationFn: async () => {
      guard?.();
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      guard?.();
      await shareDocumentCopy(
        epoch,
        async () => {
          guard?.();
          const response = await read();
          guard?.();
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return {
            name: `${filename}${EXTENSION_BY_MIME_TYPE[type] || ''}`,
            type,
            bytes: new Uint8Array(response.data),
          };
        },
        (uri, type) =>
          Sharing.shareAsync(uri, {
            mimeType: type,
            UTI: type === 'text/csv' ? 'public.comma-separated-values-text' : UTI_BY_MIME_TYPE[type],
          }),
        guard,
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
