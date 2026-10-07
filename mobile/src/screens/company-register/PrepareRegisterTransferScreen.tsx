import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getErrorMessage,
  isPreparedRegisterTransfer,
  prepareRegisterTransfer,
  REGISTER_TRANSFER_COPY as COPY,
  type RegisterTransferPreparation,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { EvidencePicker, Field, isoDay, utcToday } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { transfersKey, useClassRegister, useTransferMembers, useRegisterAppointments } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

type Draft = {
  fromMember: string;
  toMember: string;
  name: string;
  residentialAddress: string;
  shares: string;
  signedOn: string;
  lodgedOn: string;
  terms: string;
  approvingDirector: string;
  authorityReference: string;
  reason: string;
};
const FAILED = 'The preparation response could not be confirmed. Retry with the same details.';

export function PrepareRegisterTransferScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterTransfer key={epoch} epoch={epoch} />;
}

function PrepareRegisterTransfer({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { tokenUuid, companyUuid } = useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterTransfer'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const members = useTransferMembers(epoch, tokenUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const authority = useRegisterEvidence(companyUuid, 'authority');
  const instrument = useRegisterEvidence(companyUuid, 'supporting');
  const [newMemberId] = useState(() => Crypto.randomUUID());
  const [draft, setDraft] = useState<Draft>({
    fromMember: '',
    toMember: 'new',
    name: '',
    residentialAddress: '',
    shares: '',
    signedOn: utcToday(),
    lodgedOn: utcToday(),
    terms: '',
    approvingDirector: '',
    authorityReference: '',
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const pending = useRef(false);
  const [retry, setRetry] = useState<{ request: RegisterTransferPreparation; newParticulars: boolean } | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const change = (key: keyof Draft, value: string) => {
    setRetry(null);
    setError(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const eligible = members.data?.filter((member) => member.walletless) ?? [];
  const from = eligible.find(
    (member) => member.member === draft.fromMember && member.particularsRetained && BigInt(member.currentShares) > 0n,
  );
  const recipient = eligible.find((member) => member.member === draft.toMember);
  const fresh = retry?.newParticulars ?? (draft.toMember === 'new' || (!!recipient && !recipient.particularsRetained));
  const problem = !from
    ? 'Select an identified transferor holding shares in this class.'
    : draft.toMember !== 'new' && (!recipient || draft.toMember === draft.fromMember)
      ? 'Select a different recipient.'
      : fresh && (!draft.name.trim() || !draft.residentialAddress.trim())
        ? 'Give the recipient’s name and residential address from the signed instrument.'
        : !/^[1-9]\d*$/.test(draft.shares.trim()) || BigInt(draft.shares.trim()) > BigInt(from.currentShares)
          ? 'Enter a positive whole share quantity within the transferor’s holding.'
          : ![draft.signedOn.trim(), draft.lodgedOn.trim()].every((date) => isoDay(date) && date <= utcToday()) ||
              draft.signedOn.trim() > draft.lodgedOn.trim()
            ? 'Enter signing no later than lodgement, and lodgement no later than today (UTC).'
            : !draft.terms.trim() ||
                !draft.approvingDirector.trim() ||
                !draft.authorityReference.trim() ||
                !draft.reason.trim()
              ? 'Give the non-paid terms, approving director, authority reference and reason.'
              : !authority.name || !instrument.name
                ? 'Choose the director authority and signed transfer instrument.'
                : null;
  const busy = submitting || authority.busy || instrument.busy;
  const fetching = register.isFetching || members.isFetching || appointments.isFetching;
  const supported = register.data?.initialized && register.data.token.status === 'draft';
  const ready =
    (!!retry || !problem) &&
    !busy &&
    !!steps?.prepare &&
    supported &&
    register.isSuccess &&
    members.isSuccess &&
    appointments.isSuccess &&
    !fetching;
  const pick = async (document: ReturnType<typeof useRegisterEvidence>) => {
    setError(null);
    try {
      if (await document.pick()) {
        setRetry(null);
        setError(null);
      }
    } catch (cause) {
      if (live.current && epoch === getSessionEpoch())
        setError(getErrorMessage(cause, 'The document could not be selected. Try again.'));
    }
  };
  const refresh = () => Promise.all([register.refetch(), members.refetch(), appointments.refetch()]);
  const submit = async () => {
    const appointment = steps?.prepare;
    if (!ready || !appointment || pending.current) return;
    const guard = () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('This transfer is no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      guard();
      let retained = retry;
      if (!retained) {
        const retainedAuthority = await authority.upload(appointment.uuid, guard);
        const retainedInstrument = await instrument.upload(appointment.uuid, guard);
        const request: RegisterTransferPreparation = {
          operationId: Crypto.randomUUID(),
          appointment: appointment.uuid,
          tokenId: tokenUuid,
          fromMember: draft.fromMember,
          toMember: draft.toMember === 'new' ? newMemberId : draft.toMember,
          newMember: draft.toMember === 'new',
          ...(fresh ? { name: draft.name.trim(), residentialAddress: draft.residentialAddress.trim() } : {}),
          shares: draft.shares.trim(),
          signedOn: draft.signedOn.trim(),
          lodgedOn: draft.lodgedOn.trim(),
          terms: draft.terms.trim(),
          approvingDirector: draft.approvingDirector.trim(),
          authorityReference: draft.authorityReference.trim(),
          reason: draft.reason.trim(),
          authorityEvidence: retainedAuthority.uuid,
          instrumentEvidence: retainedInstrument.uuid,
        };
        retained = { request, newParticulars: fresh };
        setRetry(retained);
      }
      const { request: preparation, newParticulars } = retained;
      guard();
      const response = await prepareRegisterTransfer(apiClient, preparation, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (!isPreparedRegisterTransfer(response.data, preparation, newParticulars))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      setRetry(null);
      await queryClient.invalidateQueries({ queryKey: transfersKey(epoch, tokenUuid) });
      guard();
      navigation.goBack();
    } catch (cause) {
      const status = failureStatus(cause);
      if (status && status < 500) setRetry(null);
      try {
        guard();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, FAILED, FAILED));
      if (status === 400 || status === 404 || status === 409) await refresh();
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  if (register.isPending || members.isPending || appointments.isPending)
    return (
      <Page title="Register">
        <Text style={styles.muted}>Loading the register members and your appointments…</Text>
      </Page>
    );
  if (register.isError || members.isError || appointments.isError)
    return (
      <Page title="Register">
        <Text accessibilityRole="alert" style={styles.error}>
          The register members and your appointments could not be loaded.
        </Text>
        <Action label="Retry" disabled={fetching} onPress={() => void refresh()} />
      </Page>
    );
  if (!steps?.prepare)
    return (
      <Page title="Register">
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  if (!supported)
    return (
      <Page title="Register">
        <Text style={styles.muted}>
          This transfer requires an opened register for a draft share class without a deployed contract.
        </Text>
      </Page>
    );
  const fields: [keyof Draft, string, number][] = [
    ['shares', COPY.SHARES, 78],
    ['signedOn', COPY.SIGNED_ON, 10],
    ['lodgedOn', COPY.LODGED_ON, 10],
    ['terms', COPY.TERMS, 1000],
    ['approvingDirector', COPY.DIRECTOR, 255],
    ['authorityReference', COPY.AUTHORITY_REFERENCE, 255],
    ['reason', COPY.REASON, 1000],
  ];
  return (
    <Page testID="prepare-transfer-screen" title="Register" lede={COPY.NOTE} keyboardShouldPersistTaps="handled">
      <Section title={register.data.token.name}>
        <Text style={styles.heading}>{COPY.FROM}</Text>
        <Text style={styles.text}>{from?.name || 'Choose the transferor'}</Text>
        <View style={styles.choices}>
          {eligible
            .filter((member) => member.particularsRetained && BigInt(member.currentShares) > 0n)
            .map((member) => (
              <Action
                key={member.member}
                label={`${member.name} · ${member.currentShares} shares`}
                accessibilityLabel={`Transferor ${member.name} ${member.member}`}
                disabled={busy || draft.fromMember === member.member}
                onPress={() => change('fromMember', member.member)}
              />
            ))}
        </View>
        <Text style={styles.heading}>{COPY.TO}</Text>
        <Text style={styles.text}>{draft.toMember === 'new' ? 'New member' : recipient?.name || draft.toMember}</Text>
        <Action
          label="Use a new recipient"
          disabled={busy || draft.toMember === 'new'}
          onPress={() => change('toMember', 'new')}
        />
        <View style={styles.choices}>
          {eligible
            .filter((member) => member.member !== draft.fromMember)
            .map((member) => (
              <Action
                key={member.member}
                label={`${member.name || 'Recorded member'} · ${member.currentShares} shares in this class`}
                accessibilityLabel={`Recipient ${member.name || 'Recorded member'} ${member.member}`}
                disabled={busy || draft.toMember === member.member}
                onPress={() => change('toMember', member.member)}
              />
            ))}
        </View>
        {fresh ? (
          <>
            <Field
              label={COPY.NAME}
              value={draft.name}
              editable={!busy}
              maxLength={255}
              onChange={(value) => change('name', value)}
            />
            <Field
              label={COPY.ADDRESS}
              value={draft.residentialAddress}
              editable={!busy}
              multiline
              maxLength={1000}
              onChange={(value) => change('residentialAddress', value)}
            />
          </>
        ) : (
          <Text style={styles.muted}>
            The transfer retains the recipient’s recorded particulars. Check them in the preview.
          </Text>
        )}
        {recipient?.lastCeasedOn && (
          <Text style={styles.muted}>
            Last ceased in this class: {recipient.lastCeasedOn}. The same member ID is retained on return.
          </Text>
        )}
        {fresh && draft.toMember !== 'new' && (
          <Text style={styles.muted}>
            This member’s particulars passed the retention period. Supply their current particulars from the signed
            instrument, keeping their existing member ID.
          </Text>
        )}
        {fields.map(([key, label, maxLength]) => (
          <Field
            key={key}
            label={label}
            value={draft[key]}
            editable={!busy}
            maxLength={maxLength}
            keyboardType={key === 'shares' ? 'number-pad' : undefined}
            multiline={key === 'terms' || key === 'reason'}
            onChange={(value) => change(key, value)}
          />
        ))}
        <Text style={styles.muted}>
          Signing and lodgement dates use YYYY-MM-DD. {COPY.DIRECTOR_NOTE} {COPY.EFFECTIVE_NOTE}
        </Text>
        <EvidencePicker
          title={COPY.AUTHORITY_DOCUMENT}
          noun="authority document"
          evidence={authority}
          disabled={busy}
          onPick={() => void pick(authority)}
        />
        <EvidencePicker
          title={COPY.INSTRUMENT_DOCUMENT}
          noun="signed transfer instrument"
          evidence={instrument}
          disabled={busy}
          onPick={() => void pick(instrument)}
        />
        <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
        {retry ? (
          <Text style={styles.muted}>
            The unchanged retry will retrieve the original preparation, including its member IDs and retained documents.
            Edit a field to prepare a different transfer.
          </Text>
        ) : (
          problem && <Text style={styles.muted}>{problem}</Text>
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.muted}>
          If the preparation response is interrupted, retry with unchanged details to retrieve the same transfer.
        </Text>
        <Action
          label={submitting ? 'Preparing…' : COPY.SUBMIT}
          primary
          disabled={!ready}
          onPress={() => void submit()}
        />
      </Section>
    </Page>
  );
}
