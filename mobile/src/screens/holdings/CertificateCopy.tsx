import * as Crypto from 'expo-crypto';
import {
  formatDateTime,
  getMemberCertificateFileBytes,
  type MemberCertificateRequest,
  type useMemberRecords,
} from '@ledova/shared';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';

export function CertificateCopy({
  read,
  request,
}: {
  read: ReturnType<typeof useMemberRecords>;
  request: MemberCertificateRequest;
}) {
  const guard = () => {
    read.guardCertificate(request.uuid);
  };
  return (
    <RegisterCopy
      label="Share PDF"
      accessibilityLabel={`Share PDF (unsigned certificate requested ${formatDateTime(request.createdAt)})`}
      filename={`member-certificate-${request.uuid}`}
      epoch={orderSubmissionSession.getEpoch()}
      guard={guard}
      read={async () => {
        const captured = read.guardCertificate(request.uuid);
        const check = () => {
          const current = read.guardCertificate(request.uuid);
          if (
            current.uuid !== captured.uuid ||
            current.digest !== captured.digest ||
            current.fileSize !== captured.fileSize
          )
            throw new Error('The certificate fulfilment changed. Refresh your records.');
        };
        check();
        const response = await getMemberCertificateFileBytes(apiClient, request.uuid, {
          ...orderSubmissionSession.requestConfig(),
          ledovaSubmissionGuard: check,
        });
        check();
        if (
          !(response.data instanceof ArrayBuffer) ||
          response.data.byteLength !== captured.fileSize ||
          String(response.headers['content-type']).split(';')[0] !== 'application/pdf'
        )
          throw new Error('The recipient certificate PDF could not be confirmed.');
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(response.data));
        check();
        if (
          Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('') !==
          captured.digest
        )
          throw new Error('The recipient certificate digest does not match its retained record.');
        return response;
      }}
    />
  );
}
