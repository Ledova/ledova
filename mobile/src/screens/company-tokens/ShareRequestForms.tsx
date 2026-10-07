import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  MAX_REQUEST_SHARES,
  createCapitalIncrease,
  formatShareCount,
  getErrorMessage,
  raisedSupply,
  requestShares,
  type CompanyShareToken,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { useCompanyStyles } from '../company-register/styles';

interface RequestProps {
  token: CompanyShareToken;
  classRead: { isError: boolean; isFetching: boolean; refetch: () => Promise<unknown> };
  guard: () => void;
  epoch?: number;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

function useRequestGuard(guard: () => void) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => {
    if (!mounted.current) throw new Error('The owner request is no longer open.');
    guard();
  };
}

function ClassReadState({ query }: { query: RequestProps['classRead'] }) {
  const styles = useCompanyStyles();
  if (!query.isError)
    return query.isFetching ? <Text style={styles.muted}>Refreshing class state before continuing.</Text> : null;
  return (
    <View style={styles.group}>
      <Text accessibilityRole="alert" style={styles.error}>
        The class state could not be refreshed. Your draft is kept; retry before submitting.
      </Text>
      <Action label="Retry class state" disabled={query.isFetching} onPress={() => void query.refetch()} />
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  numeric?: boolean;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        keyboardType={numeric ? 'number-pad' : 'default'}
        autoCapitalize="none"
        style={styles.input}
      />
    </View>
  );
}

export function RaiseSharesForm({ token, classRead, guard, epoch, onClose, onSuccess }: RequestProps) {
  const styles = useCompanyStyles();
  const guardRequest = useRequestGuard(guard);
  const config = { ledovaSubmissionGuard: guardRequest, ledovaSessionEpoch: epoch };
  const [additional, setAdditional] = useState('');
  const [purpose, setPurpose] = useState('');
  const [boardReference, setBoardReference] = useState('');
  const [shareholderReference, setShareholderReference] = useState('');
  const additionalShares = requestShares(additional);
  const newTotal = raisedSupply(token.totalSupply, additional);
  const newAuthorizedTotal = newTotal === null ? null : requestShares(newTotal);
  const valid =
    token.isOwner &&
    !classRead.isError &&
    !classRead.isFetching &&
    token.status === 'deployed' &&
    additionalShares !== null &&
    newAuthorizedTotal !== null &&
    purpose.trim() !== '' &&
    boardReference.trim() !== '';
  const request = useMutation({
    mutationFn: async () => {
      guardRequest();
      const response = await createCapitalIncrease(
        apiClient,
        {
          token: token.uuid,
          additionalShares: additionalShares!,
          newAuthorizedTotal: newAuthorizedTotal!,
          purpose: purpose.trim(),
          boardResolutionReference: boardReference.trim(),
          shareholderApprovalReference: shareholderReference.trim() || undefined,
        },
        config,
      );
      guardRequest();
      return response;
    },
    onSuccess: async () => {
      guardRequest();
      await onSuccess();
      guardRequest();
      onClose();
    },
  });
  return (
    <CustomModal
      visible
      title="Raise authorised shares"
      onClose={() => {
        if (!request.isPending) onClose();
      }}
      busy={request.isPending}
      dismissLabel="Dismiss request"
      showFooter
      confirmLabel="Create request"
      confirmDisabled={!valid || request.isPending}
      onConfirm={() => {
        if (valid && !request.isPending) request.mutate();
      }}
    >
      <ClassReadState query={classRead} />
      <Text style={styles.muted}>
        Create a request, then submit it for staff review. Staff approval and execution raise the authorised cap; they
        do not issue shares.
      </Text>
      <Text style={styles.text}>Current authorised shares: {formatShareCount(token.totalSupply)}</Text>
      {request.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {getErrorMessage(request.error, 'The request was refused. Try again.')}
        </Text>
      )}
      <Field
        label="Additional shares"
        value={additional}
        onChange={setAdditional}
        disabled={request.isPending}
        numeric
      />
      {newTotal !== null && <Text style={styles.text}>New authorised total: {formatShareCount(newTotal)}</Text>}
      <Text style={styles.muted}>
        The new authorised total must be at most {formatShareCount(MAX_REQUEST_SHARES.toString())} shares under the
        current request limit.
      </Text>
      {additional !== '' && (additionalShares === null || newAuthorizedTotal === null) && (
        <Text accessibilityRole="alert" style={styles.error}>
          Enter positive whole shares within the supported request limit.
        </Text>
      )}
      <Field label="Purpose" value={purpose} onChange={setPurpose} disabled={request.isPending} />
      <Field
        label="Board resolution reference"
        value={boardReference}
        onChange={setBoardReference}
        disabled={request.isPending}
      />
      <Field
        label="Shareholder approval reference (optional)"
        value={shareholderReference}
        onChange={setShareholderReference}
        disabled={request.isPending}
      />
      {token.status !== 'deployed' && (
        <Text accessibilityRole="alert" style={styles.error}>
          The class must be deployed and unpaused before you request a raise.
        </Text>
      )}
    </CustomModal>
  );
}
