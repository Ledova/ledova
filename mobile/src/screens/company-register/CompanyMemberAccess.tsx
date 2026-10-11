import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Text, View } from 'react-native';
import { isUuid, useCompanyMemberAccess } from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { EvidencePicker, Field } from './RegisterFields';
import { useRegisterEvidence } from './useRegisterEvidence';
import { useCompanyStyles } from './styles';

export function CompanyMemberAccess({ company, sourceReady = true }: { company: string; sourceReady?: boolean }) {
  const access = useCompanyMemberAccess(apiClient, company, Crypto.randomUUID, orderSubmissionSession, sourceReady);
  const styles = useCompanyStyles();
  const evidence = useRegisterEvidence(company, 'supporting');
  const [member, setMember] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [request, setRequest] = useState('');
  const [asAt, setAsAt] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const held = access.busy || uploading || evidence.busy || !!access.retry;
  const prepare = async () => {
    if (!access.prepare || uploading) return;
    setUploading(true);
    setUploadError('');
    try {
      const uploaded = await evidence.upload(access.prepare.uuid, access.guardPrepare);
      await access.prepareRequest(request, uploaded.uuid, asAt, reason.trim());
    } catch (failure) {
      setUploadError(failure instanceof Error ? failure.message : 'The supporting document could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };
  return (
    <Section title="Member access and requests">
      <Text style={styles.muted}>
        A current company administrator invites one exact member to their own records. This creates no company
        appointment, holding or wallet link. Share the code privately; Ledova does not email it.
      </Text>
      <Action label="Refresh member access" disabled={access.busy || uploading} onPress={() => void access.refresh()} />
      {access.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {access.error}
        </Text>
      )}
      {access.notice && <Text style={styles.text}>{access.notice}</Text>}
      {access.retry && (
        <Action
          label="Retry original company member action"
          disabled={access.busy}
          onPress={() => void access.recover()}
        />
      )}
      {access.admin && (
        <>
          <Field label="Member UUID" value={member} editable={!held} onChange={setMember} />
          <Text style={styles.muted}>
            Use the member UUID recorded in this company&apos;s Register or employee award; an award-only recipient
            needs no holding.
          </Text>
          <Field
            label="Intended recipient email"
            value={email}
            editable={!held}
            keyboardType="email-address"
            onChange={setEmail}
          />
          <Action
            label="Create member invitation"
            disabled={held || !isUuid(member) || !email.trim()}
            onPress={() => void access.invite(member, email.trim())}
          />
          {access.code && (
            <Text selectable style={styles.text}>
              One-time member invitation code: {access.code}
            </Text>
          )}
          {access.access?.invitations.map((invitation) => (
            <Text key={invitation.uuid} style={styles.text}>
              Invitation {invitation.uuid} · Member {invitation.member} · {invitation.intendedEmail} ·{' '}
              {invitation.status} · Until {invitation.acceptanceDeadline}
            </Text>
          ))}
          <Field label="Company action reason" value={reason} editable={!held} multiline onChange={setReason} />
          {access.access?.associations.map((association) => (
            <View key={association.uuid} style={styles.entry}>
              <Text style={styles.text}>
                Member {association.member} · Account {association.userAccount} ·{' '}
                {association.current ? 'Current access' : 'Revoked access'}
              </Text>
              {association.current && (
                <Action
                  label={`Revoke member access ${association.uuid}`}
                  disabled={held || !reason.trim()}
                  onPress={() => void access.revoke(association.uuid, reason.trim())}
                />
              )}
            </View>
          ))}
        </>
      )}
      {access.requests && (
        <>
          <Text style={styles.muted}>
            Member particulars requests are proposals. Prepare a separate company instruction with supporting evidence;
            approval and application use Register particulars changes below.
          </Text>
          {access.requests.particulars.map((item) => (
            <View key={item.uuid} style={styles.entry}>
              <Text style={styles.text}>
                Member {item.member} · {item.name} · {item.residentialAddress} · {item.status}
                {item.change ? ` · Company instruction ${item.change}` : ''}
              </Text>
              {item.status === 'submitted' && access.prepare && (
                <Action
                  label={`Prepare member particulars request ${item.uuid}`}
                  disabled={held}
                  onPress={() => setRequest(item.uuid)}
                />
              )}
            </View>
          ))}
          {access.requests.particulars.some((item) => item.uuid === request && item.status === 'submitted') &&
            access.prepare && (
              <View style={styles.group}>
                <Text style={styles.text}>Selected member request {request}</Text>
                <EvidencePicker
                  title="Company supporting document"
                  noun="supporting document"
                  evidence={evidence}
                  disabled={held}
                  onPick={() => void evidence.pick()}
                />
                <Field label="As-at date (UTC)" value={asAt} editable={!held} onChange={setAsAt} />
                {!access.admin && (
                  <Field label="Company action reason" value={reason} editable={!held} multiline onChange={setReason} />
                )}
                {uploadError && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {uploadError}
                  </Text>
                )}
                <Action
                  label="Record company particulars instruction"
                  disabled={held || !evidence.name || !reason.trim() || !asAt}
                  onPress={() => void prepare()}
                />
              </View>
            )}
          <Text style={styles.muted}>
            Certificate requests are retained requests only. Certificate fulfilment remains separate output work.
          </Text>
          {access.requests.certificates.map((item) => (
            <Text key={item.uuid} style={styles.text}>
              Certificate request {item.uuid} · Member {item.member} · Entry {item.entry} · {item.status}
            </Text>
          ))}
        </>
      )}
    </Section>
  );
}
