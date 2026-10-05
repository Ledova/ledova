import { Text } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { COMPANY_TOKEN_ENDPOINTS, REGISTER_COPY } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy } from '../../services/documentCopies';
import { assertSessionEpoch, getSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from './styles';

export function RegisterDownload({
  uuid,
  disabled,
  accessibilityLabel,
}: {
  uuid: string;
  disabled: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useCompanyStyles();
  const download = useMutation({
    mutationFn: async () => {
      const epoch = getSessionEpoch();
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      assertSessionEpoch(epoch);
      await shareDocumentCopy(
        epoch,
        async () => {
          const { data } = await apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT(uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
          });
          return { name: `register-${uuid}.csv`, type: 'text/csv', bytes: new Uint8Array(data) };
        },
        (uri, type) => Sharing.shareAsync(uri, { mimeType: type, UTI: 'public.comma-separated-values-text' }),
      );
    },
  });
  return (
    <>
      <Text style={styles.muted}>{REGISTER_COPY.PRIVACY_NOTE}</Text>
      <Action
        label={REGISTER_COPY.DOWNLOAD}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled || download.isPending}
        onPress={() => download.mutate()}
      />
      {download.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {REGISTER_COPY.DOWNLOAD_FAILED}
        </Text>
      )}
    </>
  );
}
