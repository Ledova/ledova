import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  COMPANY_AUTHORITY_CAPABILITIES,
  submitCompanyAuthorityRequest,
  type CompanyListItem,
  type CompanyAuthorityRequest,
  type CompanyAuthoritySubmission,
  type CompanyCapability,
} from '@ledova/shared';
import { Action, Choice } from '../../components/Ledger';
import { useDocumentUpload } from '../../hooks/useDocumentUpload';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from '../company-register/styles';
import { AuthorityExpiryField } from './AuthorityExpiryField';

export function AuthorityRequestForm({
  company,
  blocked,
  onSubmitted,
}: {
  company: CompanyListItem;
  blocked: boolean;
  onSubmitted: (request: CompanyAuthorityRequest) => void;
}) {
  const styles = useCompanyStyles();
  const document = useDocumentUpload(company.uuid);
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());
  const [requested, setRequested] = useState<CompanyCapability[]>([]);
  const [delegatable, setDelegatable] = useState<CompanyCapability[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = document.isPicking || document.isSubmitting;
  const disabled = blocked || busy || company.status !== 'draft';
  const resetKey = () => {
    setIdempotencyKey(Crypto.randomUUID());
    setError(null);
  };
  const toggle = (scope: 'requested' | 'delegatable', capability: CompanyCapability) => {
    if (disabled) return;
    const values = scope === 'requested' ? requested : delegatable;
    const update = scope === 'requested' ? setRequested : setDelegatable;
    update(values.includes(capability) ? values.filter((value) => value !== capability) : [...values, capability]);
    resetKey();
  };
  const pick = async () => {
    if (disabled) return;
    const epoch = getSessionEpoch();
    setError(null);
    try {
      if (await document.pick()) resetKey();
    } catch (cause) {
      if (epoch === getSessionEpoch())
        setError(apiErrorSentence(cause, 'The evidence could not be selected. Try again.'));
    }
  };
  const valid = !!document.file && requested.length + delegatable.length > 0 && !disabled;
  const submit = async () => {
    if (!valid) return;
    const epoch = getSessionEpoch();
    setError(null);
    try {
      let submitted: CompanyAuthorityRequest | undefined;
      const completed = await document.submit(async ({ file, owner, sessionEpoch }) => {
        const response = await submitCompanyAuthorityRequest(
          apiClient,
          {
            company: owner,
            idempotencyKey,
            file: file as unknown as CompanyAuthoritySubmission['file'],
            requestedCapabilities: requested,
            delegatableCapabilities: delegatable,
            ...(expiresAt ? { requestedExpiresAt: expiresAt } : {}),
          },
          { ledovaSessionEpoch: sessionEpoch },
        );
        submitted = response.data;
      });
      if (completed && submitted && epoch === getSessionEpoch()) {
        onSubmitted(submitted);
        resetKey();
      }
    } catch (cause) {
      if (epoch === getSessionEpoch())
        setError(apiErrorSentence(cause, 'The request could not be submitted. Retry with the same details.'));
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{company.name}</Text>
      <Text style={styles.muted}>ACN {company.acn}</Text>
      <Text style={styles.muted}>
        Request authority for yourself using evidence of your relationship with this company. Requested permissions are
        proposals; submission does not appoint you or activate the company.
      </Text>
      {(
        [
          ['requested', 'Permissions you would exercise', requested],
          ['delegatable', 'Permissions you would delegate', delegatable],
        ] as const
      ).map(([scope, label, values]) => (
        <View style={styles.group} key={scope}>
          <Text style={styles.heading}>{label}</Text>
          <View style={styles.choices}>
            {COMPANY_AUTHORITY_CAPABILITIES.map(({ value, label: capabilityLabel }) => (
              <Choice
                key={value}
                label={capabilityLabel}
                accessibilityLabel={`${label}: ${capabilityLabel}`}
                selected={values.includes(value)}
                disabled={disabled}
                onPress={() => toggle(scope, value)}
              />
            ))}
          </View>
        </View>
      ))}
      <Text style={styles.muted}>
        Delegation is requested separately. Select at least one permission in either group.
      </Text>
      <AuthorityExpiryField
        value={expiresAt}
        disabled={disabled}
        onChange={(value) => {
          if (disabled || value === expiresAt) return;
          setExpiresAt(value);
          resetKey();
        }}
      />
      <Text style={styles.heading}>Representative evidence</Text>
      <Text style={styles.muted}>Choose a PDF, PNG or JPEG up to 10 MB. The retained submission cannot be edited.</Text>
      {document.file && <Text style={styles.text}>{document.file.name}</Text>}
      <Action
        label={document.file ? 'Replace evidence' : 'Choose evidence'}
        disabled={disabled}
        onPress={() => void pick()}
      />
      {!!document.file && (
        <Action
          label="Remove selected evidence"
          disabled={disabled}
          onPress={() => {
            document.clear();
            resetKey();
          }}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Text style={styles.muted}>
        If a response is interrupted, retry without changing the details to retrieve the same request. Changed evidence,
        company or permissions need a new request.
      </Text>
      <Action
        label={document.isSubmitting ? 'Submitting request…' : 'Submit authority request'}
        primary
        disabled={!valid}
        onPress={() => void submit()}
      />
    </View>
  );
}
