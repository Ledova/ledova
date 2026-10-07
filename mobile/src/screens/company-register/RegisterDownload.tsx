import { useEffect, useLayoutEffect, useRef } from 'react';
import { Text } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { COMPANY_TOKEN_ENDPOINTS, REGISTER_COPY, useSubmissionOwner } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
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
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const mounted = useRef(true);
  const current = useRef({ uuid, disabled });
  useLayoutEffect(() => {
    current.current = { uuid, disabled };
  }, [uuid, disabled]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const download = useMutation({
    mutationFn: async () => {
      const epoch = getSessionEpoch();
      const guard = () => {
        assertSessionEpoch(epoch);
        if (
          !mounted.current ||
          !owner ||
          boundary.get() !== owner ||
          current.current.uuid !== uuid ||
          current.current.disabled
        )
          throw new Error('The register changed. Reopen it before sharing a copy.');
      };
      guard();
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      guard();
      await shareDocumentCopy(
        epoch,
        async () => {
          guard();
          const { data } = await apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT(uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: guard,
          });
          guard();
          return { name: `register-${uuid}.csv`, type: 'text/csv', bytes: new Uint8Array(data) };
        },
        (uri, type) => {
          guard();
          return Sharing.shareAsync(uri, { mimeType: type, UTI: 'public.comma-separated-values-text' });
        },
      );
    },
  });
  return (
    <>
      <Text style={styles.muted}>{REGISTER_COPY.PRIVACY_NOTE}</Text>
      <Action
        label={REGISTER_COPY.DOWNLOAD}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled || !owner || download.isPending}
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
