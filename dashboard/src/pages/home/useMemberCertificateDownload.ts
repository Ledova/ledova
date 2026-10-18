import { useState } from 'react';
import { getMemberCertificateFile, type MemberCertificateRequest, type useMemberRecords } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';

export function useMemberCertificateDownload(
  read: ReturnType<typeof useMemberRecords>,
  request: MemberCertificateRequest,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
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
      const { data } = await getMemberCertificateFile(apiClient, request.uuid, { ledovaSubmissionGuard: check });
      check();
      if (!(data instanceof Blob) || !/^application\/pdf(?:;|$)/.test(data.type) || data.size !== captured.fileSize)
        throw new Error('The recipient certificate PDF could not be confirmed.');
      const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
      check();
      if (
        Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('') !== captured.digest
      )
        throw new Error('The recipient certificate digest does not match its retained record.');
      saveFile(data, `member-certificate-${request.uuid}.pdf`);
    } catch {
      setError('The certificate could not be downloaded. Refresh your current member records.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, download };
}
