import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  apiErrorSentence,
  createRegisterInspectionCopyBytes,
  getRegisterInspectionPreview,
  REGISTER_COPY,
  useSubmissionOwner,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { assertSessionEpoch } from '../../services/sessionScope';
import { RegisterCopy } from './RegisterCopy';
import { useCompanyStyles } from './styles';

type Preview = Awaited<ReturnType<typeof getRegisterInspectionPreview>>['data'];
type Draft = { instruction: string; requestedOn: string; recipient: string };
type Target = { preview: Preview; request: Draft & { appointment: string; sourceDigest: string }; revision: number };
const EMPTY: Draft = { instruction: '', requestedOn: '', recipient: '' };

export function RegisterInspectionCopy({
  uuid,
  name,
  epoch,
  disabled,
}: {
  uuid: string;
  name: string;
  epoch: number;
  disabled: boolean;
}) {
  const ownership = useSubmissionOwner(orderSubmissionSession);
  return (
    <InspectionCopy
      key={`${epoch}/${uuid}/${ownership.owner?.userUuid}/${ownership.owner?.ownerAccountUuid}`}
      uuid={uuid}
      name={name}
      epoch={epoch}
      disabled={disabled}
      ownership={ownership}
    />
  );
}

function InspectionCopy({
  uuid,
  name,
  epoch,
  disabled,
  ownership: { owner, boundary },
}: {
  uuid: string;
  name: string;
  epoch: number;
  disabled: boolean;
  ownership: ReturnType<typeof useSubmissionOwner>;
}) {
  const styles = useCompanyStyles();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [target, setTarget] = useState<Target | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const opened = useRef(false);
  const revision = useRef(0);
  const pending = useRef(false);
  const current = useRef({ uuid, disabled });
  const confirmed = useRef<Target | null>(null);
  const invalidate = () => {
    revision.current++;
    confirmed.current = null;
    setTarget(null);
  };
  useLayoutEffect(() => {
    current.current = { uuid, disabled };
    if (disabled) invalidate();
  }, [uuid, disabled]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
      confirmed.current = null;
    };
  }, []);
  const guard = () => {
    assertSessionEpoch(epoch);
    if (
      !mounted.current ||
      !opened.current ||
      !owner ||
      boundary.get() !== owner ||
      current.current.uuid !== uuid ||
      current.current.disabled
    )
      throw new Error('The account or register changed. Reopen the inspection request.');
  };
  const valid =
    !!draft.instruction.trim() &&
    draft.instruction.trim().length <= 255 &&
    !!draft.recipient.trim() &&
    draft.recipient.trim().length <= 255 &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.requestedOn);
  const preview = async () => {
    if (pending.current || !valid) return;
    invalidate();
    const captured = revision.current;
    const request = {
      instruction: draft.instruction.trim(),
      requestedOn: draft.requestedOn,
      recipient: draft.recipient.trim(),
    };
    const check = () => {
      guard();
      if (revision.current !== captured) throw new Error('The inspection request changed. Preview it again.');
    };
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      check();
      const { data } = await getRegisterInspectionPreview(apiClient, uuid, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: check,
      });
      check();
      if (
        data.token !== uuid ||
        typeof data.appointment !== 'string' ||
        !data.appointment.trim() ||
        !Number.isSafeInteger(data.registerSequence) ||
        data.registerSequence < 1 ||
        typeof data.sourceDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data.sourceDigest)
      )
        throw new Error('The inspection preview does not identify this register and appointment.');
      const next: Target = {
        preview: { ...data },
        request: { ...request, appointment: data.appointment, sourceDigest: data.sourceDigest },
        revision: captured,
      };
      confirmed.current = next;
      setTarget(next);
    } catch (cause) {
      if (mounted.current && opened.current)
        setError(apiErrorSentence(cause, 'The inspection copy could not be prepared. Try again.'));
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  const shareGuard = () => {
    guard();
    if (!target || confirmed.current !== target || revision.current !== target.revision)
      throw new Error('The inspection preview changed. Prepare the copy again.');
  };
  return (
    <>
      <Action
        label="Prepare inspection copy"
        accessibilityLabel={`Prepare inspection copy for ${name}`}
        disabled={disabled || !owner || loading}
        onPress={() => {
          invalidate();
          setDraft(EMPTY);
          setError(null);
          opened.current = true;
          setVisible(true);
        }}
      />
      {visible && (
        <CustomModal
          visible
          title="Inspection copy"
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
                label="Confirm and share inspection copy"
                accessibilityLabel={`Confirm and share inspection copy for ${name}`}
                filename={`inspection-${uuid}.csv`}
                epoch={epoch}
                guard={shareGuard}
                read={async () => {
                  const response = await createRegisterInspectionCopyBytes(apiClient, uuid, target.request, {
                    ledovaSessionEpoch: epoch,
                    ledovaSubmissionGuard: shareGuard,
                  });
                  shareGuard();
                  const contentType = response.headers['content-type'];
                  if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'text/csv')
                    throw new Error('The inspection response is not a CSV copy.');
                  return response;
                }}
              />
            ) : (
              <Action
                label={loading ? 'Preparing…' : 'Preview inspection copy'}
                primary
                disabled={disabled || !owner || loading || !valid}
                onPress={() => void preview()}
              />
            )
          }
        >
          <Text style={styles.heading}>{name}</Text>
          <Text style={styles.muted}>{REGISTER_COPY.PRIVACY_NOTE}</Text>
          {target ? (
            <View style={styles.group}>
              <Rows>
                <Row label="Instruction">{target.request.instruction}</Row>
                <Row label="Recipient">{target.request.recipient}</Row>
                <Row label="Requested on">{target.request.requestedOn}</Row>
                <Row label="Register sequence">{String(target.preview.registerSequence)}</Row>
              </Rows>
              <Action
                label="Edit inspection request"
                onPress={() => {
                  invalidate();
                  setError(null);
                }}
              />
              <Action
                label="Refresh inspection preview"
                disabled={loading || disabled}
                onPress={() => void preview()}
              />
            </View>
          ) : (
            <View style={styles.group}>
              {(
                [
                  ['instruction', 'Written instruction'],
                  ['recipient', 'Recipient'],
                  ['requestedOn', 'Requested on (YYYY-MM-DD)'],
                ] as const
              ).map(([field, label]) => (
                <View key={field} style={styles.group}>
                  <Text style={styles.text}>{label}</Text>
                  <TextInput
                    accessibilityLabel={label}
                    style={styles.input}
                    value={draft[field]}
                    editable={!loading}
                    maxLength={field === 'requestedOn' ? 10 : 255}
                    autoCapitalize="none"
                    onChangeText={(value) => {
                      invalidate();
                      setDraft((prior) => ({ ...prior, [field]: value }));
                    }}
                  />
                </View>
              ))}
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
