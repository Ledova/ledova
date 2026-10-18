import { useLayoutEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  apiErrorSentence,
  createRegisterCertificateBytes,
  getRegisterCertificatePreview,
  useSubmissionOwner,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { assertSessionEpoch } from '../../services/sessionScope';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

type Preview = Awaited<ReturnType<typeof getRegisterCertificatePreview>>['data'];
type Target = {
  preview: Preview;
  request: { appointment: string; sequence: number; sourceDigest: string; instruction: string };
  revision: number;
};
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;

export function RegisterCertificate({
  epoch,
  register,
  entry,
  disabled,
  authorityGuard,
}: {
  epoch: number;
  register: TokenHoldersResponse;
  entry: RegisterEntry;
  disabled: boolean;
  authorityGuard: () => void;
}) {
  const ownership = useSubmissionOwner(orderSubmissionSession);
  return (
    <Certificate
      key={JSON.stringify([epoch, register, entry, ownership.owner])}
      epoch={epoch}
      register={register}
      entry={entry}
      disabled={disabled}
      ownership={ownership}
      authorityGuard={authorityGuard}
    />
  );
}

function Certificate({
  epoch,
  register,
  entry,
  disabled,
  ownership: { owner, boundary },
  authorityGuard,
}: {
  epoch: number;
  register: TokenHoldersResponse;
  entry: RegisterEntry;
  disabled: boolean;
  ownership: ReturnType<typeof useSubmissionOwner>;
  authorityGuard: () => void;
}) {
  const styles = useCompanyStyles();
  const [visible, setVisible] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const opened = useRef(false);
  const revision = useRef(0);
  const pending = useRef(false);
  const blocked = useRef(disabled);
  const confirmed = useRef<Target | null>(null);
  const token = register.token.uuid;
  const description = `entry ${entry.sequence} of ${register.token.name}`;
  const invalidate = () => {
    revision.current++;
    confirmed.current = null;
    setTarget(null);
  };
  useLayoutEffect(() => {
    blocked.current = disabled;
    if (disabled) invalidate();
  }, [disabled]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
      confirmed.current = null;
    };
  }, []);
  const guard = () => {
    assertSessionEpoch(epoch);
    authorityGuard();
    if (
      !mounted.current ||
      !opened.current ||
      !owner ||
      boundary.get() !== owner ||
      blocked.current ||
      !register.initialized ||
      entry.correctedBy !== null ||
      !['issue', 'transfer'].includes(entry.kind)
    )
      throw new Error('The account, register or entry changed. Reopen the certificate request.');
  };
  const valid = !!instruction.trim() && instruction.trim().length <= 255;
  const preview = async () => {
    if (pending.current || !valid) return;
    invalidate();
    const captured = revision.current;
    const written = instruction.trim();
    const check = () => {
      guard();
      if (revision.current !== captured) throw new Error('The certificate request changed. Preview it again.');
    };
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      check();
      const { data } = await getRegisterCertificatePreview(apiClient, token, entry.sequence, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: check,
      });
      check();
      if (
        !data ||
        Array.isArray(data) ||
        !uuid(data.token) ||
        data.token !== token ||
        !uuid(data.entry) ||
        data.entry !== entry.uuid ||
        !uuid(data.appointment) ||
        !positive(data.sequence) ||
        data.sequence !== entry.sequence ||
        !positive(data.registerSequence) ||
        data.registerSequence < entry.sequence ||
        !positive(data.pageCount) ||
        data.pageCount > 2 ||
        typeof data.sourceDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data.sourceDigest)
      )
        throw new Error('The certificate preview does not identify this register entry and appointment.');
      const next: Target = {
        preview: { ...data },
        request: {
          appointment: data.appointment,
          sequence: entry.sequence,
          sourceDigest: data.sourceDigest,
          instruction: written,
        },
        revision: captured,
      };
      confirmed.current = next;
      setTarget(next);
    } catch (cause) {
      if (mounted.current && opened.current)
        setError(apiErrorSentence(cause, 'The certificate could not be prepared. Try again.'));
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  const shareGuard = () => {
    guard();
    if (!target || confirmed.current !== target || revision.current !== target.revision)
      throw new Error('The certificate preview changed. Prepare it again.');
  };
  return (
    <>
      <Action
        label="Prepare unsigned certificate"
        accessibilityLabel={`Prepare unsigned certificate for ${description}`}
        disabled={disabled || !owner || loading}
        onPress={() => {
          invalidate();
          setInstruction('');
          setError(null);
          opened.current = true;
          setVisible(true);
        }}
      />
      {visible && (
        <CustomModal
          visible
          title="Unsigned certificate"
          busy={loading}
          onClose={() => {
            opened.current = false;
            invalidate();
            setVisible(false);
          }}
          actions={
            target ? (
              <RegisterCopy
                key={target.revision}
                label="Confirm and share unsigned certificate"
                accessibilityLabel={`Confirm and share unsigned certificate for ${description}`}
                filename={`certificate-${token}-${entry.sequence}`}
                epoch={epoch}
                guard={shareGuard}
                read={async () => {
                  const response = await createRegisterCertificateBytes(apiClient, token, target.request, {
                    ledovaSessionEpoch: epoch,
                    ledovaSubmissionGuard: shareGuard,
                  });
                  shareGuard();
                  const type = response.headers['content-type'];
                  if (
                    typeof type !== 'string' ||
                    type.split(';')[0].trim().toLowerCase() !== 'application/pdf' ||
                    !(response.data instanceof ArrayBuffer) ||
                    response.data.byteLength === 0
                  )
                    throw new Error('The certificate response is not a PDF copy.');
                  return { ...response, headers: { ...response.headers, 'content-type': 'application/pdf' } };
                }}
              />
            ) : (
              <Action
                label={loading ? 'Preparing…' : 'Preview unsigned certificate'}
                primary
                disabled={disabled || !owner || loading || !valid}
                onPress={() => void preview()}
              />
            )
          }
        >
          <Text style={styles.heading}>
            {register.token.name} · Entry {entry.sequence}
          </Text>
          <Text style={styles.muted}>
            This private PDF includes member names and residential addresses. A transfer may name several members. The
            certificate is unsigned; the company is responsible for its execution and permitted use.
          </Text>
          {target ? (
            <View style={styles.group}>
              <Rows>
                <Row label="Instruction">{target.request.instruction}</Row>
                <Row label="Register sequence">{String(target.preview.registerSequence)}</Row>
                <Row label="Pages">{String(target.preview.pageCount)}</Row>
              </Rows>
              <Action
                label="Edit certificate request"
                onPress={() => {
                  invalidate();
                  setError(null);
                }}
              />
              <Action
                label="Refresh certificate preview"
                disabled={loading || disabled}
                onPress={() => void preview()}
              />
            </View>
          ) : (
            <View style={styles.group}>
              <Text style={styles.text}>Written instruction</Text>
              <TextInput
                accessibilityLabel="Written instruction"
                style={styles.input}
                value={instruction}
                editable={!loading}
                maxLength={255}
                onChangeText={(value) => {
                  invalidate();
                  setInstruction(value);
                }}
              />
            </View>
          )}
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </CustomModal>
      )}
    </>
  );
}
