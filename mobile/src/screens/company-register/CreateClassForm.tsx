import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { apiErrorSentence, type TokenType } from '@ledova/shared';
import { CustomModal } from '../../components/modal';
import { Choice, Action } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useCreateRegisterClass } from './useCreateRegisterClass';
import type { useRegisterClassCreation } from './useRegisterClassCreation';

interface Props {
  target: { uuid: string; name: string };
  read: ReturnType<typeof useRegisterClassCreation>;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

export function CreateClassForm({ target, read, onClose, onSuccess }: Props) {
  const styles = useCompanyStyles();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tokenType, setTokenType] = useState<TokenType>('ordinary');
  const { valid, create, uncertain, recoveryError, refreshClasses, close, submit } = useCreateRegisterClass({
    target,
    read,
    onClose,
    onSuccess,
    name,
    symbol,
    tokenType,
  });
  return (
    <CustomModal
      visible
      title="Add share class"
      onClose={close}
      busy={create.isPending || uncertain}
      showFooter
      onConfirm={submit}
      confirmLabel="Add share class"
      confirmDisabled={!valid || create.isPending}
    >
      <View style={styles.group}>
        <Text style={styles.text}>{target.name}</Text>
        {read.error ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              Share classes or your company appointments could not be loaded.
            </Text>
            {!uncertain && <Action label="Retry share classes" disabled={read.isRefreshing} onPress={refreshClasses} />}
          </View>
        ) : read.isRefreshing ? (
          <Text style={styles.muted}>Refreshing share classes and company appointments…</Text>
        ) : null}
        {read.companyUuid !== target.uuid && (
          <Text accessibilityRole="alert" style={styles.error}>
            This draft belongs to a company that is no longer selected.
          </Text>
        )}
        <Text style={styles.muted}>
          Record the class from the company’s records. Class code and type do not define its economic rights. Recording
          a class issues no shares.
        </Text>
        {create.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {apiErrorSentence(
              create.error,
              uncertain
                ? 'The share class result is uncertain. Refresh to check.'
                : 'The share class could not be created. Try again.',
            )}
          </Text>
        )}
        {uncertain && !create.isPending && (
          <View style={styles.group}>
            <Text style={styles.muted}>
              The request may have created the class. Refresh to check; it will not be submitted again.
            </Text>
            <Action
              label="Refresh share classes"
              disabled={read.isRefreshing}
              onPress={() => {
                refreshClasses();
              }}
            />
          </View>
        )}
        {recoveryError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {recoveryError}
          </Text>
        )}
        <Text style={styles.text}>Class name</Text>
        <TextInput
          accessibilityLabel="Class name"
          style={styles.input}
          value={name}
          editable={!create.isPending && !uncertain}
          onChangeText={setName}
        />
        <Text style={styles.text}>Class code</Text>
        <TextInput
          accessibilityLabel="Class code"
          style={styles.input}
          value={symbol}
          editable={!create.isPending && !uncertain}
          onChangeText={(value) => setSymbol(value.toUpperCase())}
        />
        <Text style={styles.text}>Class type: {tokenType}</Text>
        <View style={styles.choices}>
          {(['ordinary', 'preference', 'redeemable'] as const).map((type) => (
            <Choice
              key={type}
              label={type[0].toUpperCase() + type.slice(1)}
              selected={tokenType === type}
              disabled={create.isPending || uncertain}
              onPress={() => setTokenType(type)}
            />
          ))}
        </View>
      </View>
    </CustomModal>
  );
}
