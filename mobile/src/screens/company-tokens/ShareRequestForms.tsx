import { useState, type ReactNode } from 'react';
import {
  Text,
  TextInput,
  View,
  Modal,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  MAX_REQUEST_SHARES,
  createCapitalIncrease,
  formatShareCount,
  getErrorMessage,
  issueCompanyShares,
  raisedSupply,
  requestShares,
  type CompanyShareToken,
} from '@ledova/shared';
import { useAppTheme, overlayColors } from '../../contexts';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { useCompanyStyles } from '../company-register/styles';

function RequestModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: 20 }}
      >
        <Pressable
          accessibilityLabel="Dismiss request"
          accessibilityRole="button"
          onPress={onClose}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: overlayColors.modal }]}
        />
        <View
          accessibilityViewIsModal
          style={{ maxHeight: '90%', backgroundColor: theme.colors.surface.base, borderRadius: 8 }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12 }}>
            <Text
              accessibilityRole="header"
              style={{
                fontFamily: theme.fontFamily.display,
                fontSize: 25,
                color: theme.colors.text.primary,
                paddingBottom: 10,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border.default,
              }}
            >
              {title}
            </Text>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface RequestProps {
  token: CompanyShareToken;
  classRead: { isError: boolean; isFetching: boolean; refetch: () => Promise<unknown> };
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
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

export function IssueSharesForm({ token, classRead, onClose, onSuccess }: RequestProps) {
  const styles = useCompanyStyles();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const quantity = requestShares(amount);
  const valid =
    !classRead.isError &&
    !classRead.isFetching &&
    token.status === 'deployed' &&
    recipient.trim() !== '' &&
    quantity !== null;
  const request = useMutation({
    mutationFn: () =>
      issueCompanyShares(apiClient, token.uuid, {
        recipient: recipient.trim(),
        amount: quantity!,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      await onSuccess();
      onClose();
    },
  });
  return (
    <RequestModal
      title={`Request ${token.symbol} issuance`}
      onClose={() => {
        if (!request.isPending) onClose();
      }}
    >
      <ClassReadState query={classRead} />
      <Text style={styles.muted}>Staff review this request before any shares are issued.</Text>
      {request.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {getErrorMessage(request.error, 'The issuance request was refused. Try again.')}
        </Text>
      )}
      <Field label="Recipient address" value={recipient} onChange={setRecipient} disabled={request.isPending} />
      <Field label="Shares to issue" value={amount} onChange={setAmount} disabled={request.isPending} numeric />
      <Text style={styles.muted}>
        Each request supports up to {formatShareCount(MAX_REQUEST_SHARES.toString())} shares. Enter a positive whole
        number.
      </Text>
      {amount !== '' && quantity === null && (
        <Text accessibilityRole="alert" style={styles.error}>
          The quantity must be a whole number from 1 to {formatShareCount(MAX_REQUEST_SHARES.toString())}.
        </Text>
      )}
      <Field label="Reason (optional)" value={reason} onChange={setReason} disabled={request.isPending} />
      {token.status !== 'deployed' && (
        <Text accessibilityRole="alert" style={styles.error}>
          The class must be deployed and unpaused before you request issuance.
        </Text>
      )}
      <Action
        label="Submit issuance request"
        primary
        disabled={!valid || request.isPending}
        onPress={() => {
          if (valid && !request.isPending) request.mutate();
        }}
      />
      <Action label="Cancel" disabled={request.isPending} onPress={onClose} />
    </RequestModal>
  );
}

export function RaiseSharesForm({ token, classRead, onClose, onSuccess }: RequestProps) {
  const styles = useCompanyStyles();
  const [additional, setAdditional] = useState('');
  const [purpose, setPurpose] = useState('');
  const [boardReference, setBoardReference] = useState('');
  const [shareholderReference, setShareholderReference] = useState('');
  const additionalShares = requestShares(additional);
  const newTotal = raisedSupply(token.totalSupply, additional);
  const newAuthorizedTotal = newTotal === null ? null : requestShares(newTotal);
  const valid =
    !classRead.isError &&
    !classRead.isFetching &&
    token.status === 'deployed' &&
    additionalShares !== null &&
    newAuthorizedTotal !== null &&
    purpose.trim() !== '' &&
    boardReference.trim() !== '';
  const request = useMutation({
    mutationFn: () =>
      createCapitalIncrease(apiClient, {
        token: token.uuid,
        additionalShares: additionalShares!,
        newAuthorizedTotal: newAuthorizedTotal!,
        purpose: purpose.trim(),
        boardResolutionReference: boardReference.trim(),
        shareholderApprovalReference: shareholderReference.trim() || undefined,
      }),
    onSuccess: async () => {
      await onSuccess();
      onClose();
    },
  });
  return (
    <RequestModal
      title="Raise authorised shares"
      onClose={() => {
        if (!request.isPending) onClose();
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
      <Action
        label="Create request"
        primary
        disabled={!valid || request.isPending}
        onPress={() => {
          if (valid && !request.isPending) request.mutate();
        }}
      />
      <Action label="Cancel" disabled={request.isPending} onPress={onClose} />
    </RequestModal>
  );
}
