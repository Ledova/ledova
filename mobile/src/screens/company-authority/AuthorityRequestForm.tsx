import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
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
  const [requested, setRequested] = useState<CompanyCapability[]>(['admin']);
  const [delegatable, setDelegatable] = useState<CompanyCapability[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const current = useRef(!blocked && company.status === 'draft');
  useLayoutEffect(() => {
    current.current = !blocked && company.status === 'draft';
  }, [blocked, company.status]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = document.isPicking || document.isSubmitting || submitting;
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
      if (mounted.current && epoch === getSessionEpoch())
        setError(apiErrorSentence(cause, 'The evidence could not be selected. Try again.'));
    }
  };
  const valid = requested.length + delegatable.length > 0 && !disabled;
  const submit = async () => {
    if (!valid || pending.current) return;
    pending.current = true;
    setSubmitting(true);
    const epoch = getSessionEpoch();
    setError(null);
    try {
      let submitted: CompanyAuthorityRequest | undefined;
      const send = async (file?: CompanyAuthoritySubmission['file']) => {
        if (!mounted.current || !current.current || epoch !== getSessionEpoch())
          throw new Error('The request view changed. Reopen it to continue.');
        const response = await submitCompanyAuthorityRequest(
          apiClient,
          {
            company: company.uuid,
            idempotencyKey,
            ...(file ? { file } : {}),
            requestedCapabilities: requested,
            delegatableCapabilities: delegatable,
            ...(expiresAt ? { requestedExpiresAt: expiresAt } : {}),
          },
          {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: () => {
              if (!mounted.current || !current.current || epoch !== getSessionEpoch())
                throw new Error('The request view changed. Reopen it to continue.');
            },
          },
        );
        if (!mounted.current || !current.current || epoch !== getSessionEpoch())
          throw new Error('The request view changed. Reopen it to continue.');
        submitted = response.data;
      };
      const completed = document.file
        ? await document.submit(async ({ file, assertCurrent }) => {
            assertCurrent();
            await send(file as unknown as CompanyAuthoritySubmission['file']);
            assertCurrent();
          })
        : await send().then(() => true);
      if (completed && submitted && mounted.current && current.current && epoch === getSessionEpoch()) {
        onSubmitted(submitted);
        resetKey();
      }
    } catch (cause) {
      if (mounted.current && epoch === getSessionEpoch())
        setError(apiErrorSentence(cause, 'The request could not be submitted. Retry with the same details.'));
    } finally {
      pending.current = false;
      if (mounted.current && epoch === getSessionEpoch()) setSubmitting(false);
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{company.name}</Text>
      <Text style={styles.muted}>ACN {company.acn} · Provided by the company</Text>
      <Text style={styles.muted}>
        Submit a private request for your own representative role, then accept the authorisation declaration to
        establish your appointment. Submitting evidence alone does not appoint you or activate the company.
      </Text>
      <Text style={styles.muted}>
        Initial admission requires Manage company information and team in your own permissions. Evidence and history
        remain private to your account; no ASIC extract is required.
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
      <Text style={styles.heading}>Supporting document (optional)</Text>
      <Text style={styles.muted}>
        Optional PDF, PNG or JPEG up to 10 MB. Supporting documents can also be uploaded later in Company settings.
      </Text>
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
        label={busy ? 'Submitting request…' : 'Submit authority request'}
        primary
        disabled={!valid}
        onPress={() => void submit()}
      />
    </View>
  );
}
