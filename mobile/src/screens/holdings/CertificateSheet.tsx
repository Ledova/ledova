import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  MEMBER_CERTIFICATE_STATUS_LABELS,
  REGISTER_CORRECTION_COPY,
  formatDate,
  shareChange,
  type MemberCertificateRequest,
  type RegisterEntryKind,
  type useMemberRecords,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CustomModal, useDialogStyles } from '../../components/modal';
import { CertificateCopy } from './CertificateCopy';

type Read = ReturnType<typeof useMemberRecords>;
type Entry = Read['entries'][number];

export type Certificate = 'ready' | 'requested' | 'request' | 'other' | null;

const issueOrTransfer = (entry: Entry) => ['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase());

const receiving = (entry: Entry) => issueOrTransfer(entry) && BigInt(entry.delta) > 0n;

export const entryKind = (entry: Entry) =>
  REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind.toLowerCase() as RegisterEntryKind] ?? 'Register change';

export const entryDate = (entry: Entry) =>
  issueOrTransfer(entry) ? formatDate(entry.companyEventOn, 'Not recorded') : formatDate(entry.effectiveOn);

const ready = (request: MemberCertificateRequest) => request.status === 'fulfilled' && !!request.fulfilment;

export const currentRequest = (requests: MemberCertificateRequest[]) =>
  requests.find((request) => request.status === 'requested' || ready(request)) ?? requests[0];

export function certificateOf(entry: Entry | undefined, latest: MemberCertificateRequest | undefined): Certificate {
  if (latest && ready(latest)) return 'ready';
  if (latest?.status === 'requested') return 'requested';
  if (entry && receiving(entry)) return 'request';
  return latest ? 'other' : null;
}

export function CertificateSheet({
  read,
  className,
  entry,
  request,
  others = [],
  onClose,
}: {
  read: Read;
  className: string;
  entry?: Entry;
  request?: MemberCertificateRequest;
  others?: MemberCertificateRequest[];
  onClose: () => void;
}) {
  const styles = useDialogStyles();
  const [confirming, setConfirming] = useState<MemberCertificateRequest | null>(null);
  const held = read.busy || !!read.retry;
  const certificate = certificateOf(entry, request);
  const finish = (action: Promise<unknown> | null | undefined) => void Promise.resolve(action).finally(onClose);
  const withdraw = (item: MemberCertificateRequest) => (
    <Action
      label="Withdraw request"
      accessibilityLabel={`Withdraw certificate request ${item.uuid}`}
      disabled={held}
      onPress={() => setConfirming(item)}
    />
  );
  return (
    <CustomModal
      visible
      title="Certificate"
      busy={read.busy}
      onClose={onClose}
      cancelLabel={confirming ? 'Keep request' : 'Close'}
      onCancel={confirming ? () => setConfirming(null) : undefined}
      actions={
        confirming ? (
          <Action
            label="Withdraw request"
            primary
            disabled={held}
            onPress={() => finish(read.withdraw(confirming.uuid))}
          />
        ) : certificate === 'ready' && request ? (
          <>
            {entry && receiving(entry) && (
              <Action
                label="Request a new certificate"
                disabled={held}
                onPress={() => finish(read.requestCertificate(entry.uuid))}
              />
            )}
            <CertificateCopy read={read} request={request} />
          </>
        ) : certificate === 'requested' && request ? (
          withdraw(request)
        ) : certificate === 'request' && entry ? (
          <Action
            label="Request certificate"
            primary
            disabled={held}
            onPress={() => finish(read.requestCertificate(entry.uuid))}
          />
        ) : null
      }
    >
      <View style={styles.group}>
        <Text style={styles.text}>
          {entry
            ? `${className} · ${entryKind(entry)} of ${shareChange(entry.delta)} · ${entryDate(entry)}`
            : `${className} · requested ${formatDate(request?.createdAt)}`}
        </Text>
        <Text style={styles.muted}>
          {confirming
            ? `Withdraw the request made ${formatDate(confirming.createdAt)}? The company stops preparing it.`
            : certificate === 'ready'
              ? 'Ready to share. It is an unsigned copy; the company is responsible for executing it.'
              : certificate === 'requested'
                ? `Requested ${formatDate(request?.createdAt)}. The company prepares the certificate.`
                : certificate === 'request'
                  ? request?.status === 'withdrawn'
                    ? 'Your last request was withdrawn. You can request it again.'
                    : 'Not requested yet. The company prepares an unsigned copy on request.'
                  : 'No certificate is available for this change.'}
        </Text>
      </View>
      {!confirming && others.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.heading}>Other requests</Text>
          {others.map((item) => (
            <View key={item.uuid} style={styles.group}>
              <Text style={styles.muted}>
                {MEMBER_CERTIFICATE_STATUS_LABELS[item.status]} · requested {formatDate(item.createdAt)}
              </Text>
              {ready(item) ? (
                <CertificateCopy read={read} request={item} />
              ) : item.status === 'requested' ? (
                withdraw(item)
              ) : null}
            </View>
          ))}
        </View>
      )}
    </CustomModal>
  );
}
