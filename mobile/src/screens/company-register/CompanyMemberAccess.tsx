import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Text, View } from 'react-native';
import { getRegisterAwards, readEveryPage, useCompanyMemberAccess, type TokenHoldersResponse } from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { EvidencePicker, Field } from '../../components/register/RegisterFields';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { particularsKey, registerKey } from '../../hooks/useCompanyRegister';
import { invitationMembers } from '@ledova/shared';

export function CompanyMemberAccess({
  company,
  epoch,
  sourceReady = true,
  registers,
  onHeldChange,
}: {
  company: string;
  epoch: number;
  sourceReady?: boolean;
  registers: TokenHoldersResponse[];
  onHeldChange?: (held: boolean) => void;
}) {
  const access = useCompanyMemberAccess(
    company,
    Crypto.randomUUID,
    orderSubmissionSession,
    sourceReady,
    particularsKey(epoch, company),
  );
  const styles = useCompanyStyles();
  const evidence = useRegisterEvidence(company, 'supporting');
  const awards = useQuery({
    queryKey: [...registerKey(epoch), 'invitation-awards', company],
    enabled: !!access.admin && !!access.prepare && sourceReady,
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        access.guardPrepare();
        const response = await getRegisterAwards(
          apiClient,
          { company, page },
          {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: access.guardPrepare,
            signal,
          },
        );
        access.guardPrepare();
        return response;
      }),
  });
  let candidates: ReturnType<typeof invitationMembers> = [];
  let recipientsError = '';
  if (access.admin && sourceReady && awards.isSuccess && !awards.isFetching) {
    try {
      candidates = invitationMembers(registers, awards.data, company);
    } catch (failure) {
      recipientsError = failure instanceof Error ? failure.message : 'The company recipients could not be confirmed.';
    }
  }
  const recipientsReady = !!access.admin && sourceReady && awards.isSuccess && !awards.isFetching && !recipientsError;
  const [invitation, setInvitation] = useState({ company, member: '', email: '' });
  const member = invitation.company === company ? candidates.find(({ uuid }) => uuid === invitation.member) : undefined;
  const email = invitation.company === company ? invitation.email : '';
  if (invitation.company !== company || (recipientsReady && invitation.member && !member))
    setInvitation({ company, member: '', email: '' });
  const memberName = (uuid: string) =>
    candidates.find((item) => item.uuid === uuid)?.name ||
    registers.flatMap((item) => item.holders).find((item) => item.member === uuid)?.name ||
    'Company member';
  const [reason, setReason] = useState('');
  const [request, setRequest] = useState('');
  const [certificateInstruction, setCertificateInstruction] = useState('');
  const [asAt, setAsAt] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const held = access.busy || uploading || evidence.busy || !!access.retry;
  useEffect(() => {
    onHeldChange?.(held);
  }, [held, onHeldChange]);
  useEffect(() => () => onHeldChange?.(false), [onHeldChange]);
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
      <Action
        label="Refresh member access"
        disabled={access.busy || uploading}
        onPress={() => void Promise.all([access.refresh(), awards.refetch()])}
      />
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
          <Text style={styles.heading}>Member or award recipient</Text>
          {candidates.map((candidate) => (
            <Choice
              key={candidate.uuid}
              label={`${candidate.name} · ${candidate.classes.join(', ')} · ${candidate.sources.join(', ')}${candidates.some((other) => other.uuid !== candidate.uuid && other.name === candidate.name) ? ` · ${candidate.uuid.slice(0, 8)}` : ''}`}
              accessibilityRole="radio"
              selected={member?.uuid === candidate.uuid}
              disabled={held || !recipientsReady}
              onPress={() => setInvitation({ company, member: candidate.uuid, email })}
            />
          ))}
          {awards.isPending && <Text style={styles.muted}>Loading company recipients…</Text>}
          {(awards.isError || recipientsError) && (
            <Text accessibilityRole="alert" style={styles.error}>
              {recipientsError || 'Refresh before inviting a company member.'}
            </Text>
          )}
          {recipientsReady && candidates.length === 0 && (
            <Text style={styles.muted}>Record a member or employee award before inviting its recipient.</Text>
          )}
          <Text style={styles.muted}>An award recipient can view their own award before any shares are issued.</Text>
          <Field
            label="Intended recipient email"
            value={email}
            editable={!held}
            keyboardType="email-address"
            onChange={(value) => setInvitation({ company, member: member?.uuid ?? '', email: value })}
          />
          <Action
            label="Create member invitation"
            disabled={held || !recipientsReady || !member || !email.trim()}
            onPress={() => member && void access.invite(member.uuid, email.trim())}
          />
          {access.code && (
            <Text selectable style={styles.text}>
              One-time member invitation code: {access.code}
            </Text>
          )}
          {access.access?.invitations.map((invitation) => (
            <Text key={invitation.uuid} style={styles.text}>
              {memberName(invitation.member)} · {invitation.intendedEmail} · {invitation.status} · Until{' '}
              {invitation.acceptanceDeadline}
            </Text>
          ))}
          <Field label="Company action reason" value={reason} editable={!held} multiline onChange={setReason} />
          {access.access?.associations.map((association) => (
            <View key={association.uuid} style={styles.entry}>
              <Text style={styles.text}>
                {memberName(association.member)} · {association.current ? 'Current access' : 'Revoked access'}
              </Text>
              {association.current && (
                <Action
                  label={`Revoke access for ${memberName(association.member)}`}
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
            Fulfil a genuine receiving issue or transfer with an unsigned recipient-only PDF. The company remains
            responsible for execution and permitted use.
          </Text>
          <Field
            label="Certificate instruction reference"
            value={certificateInstruction}
            editable={!held && !access.certificateTarget}
            onChange={setCertificateInstruction}
          />
          {access.certificateTarget && (
            <View style={styles.group}>
              <Text style={styles.text}>
                Recipient member {access.certificateTarget.preview.member} · Entry{' '}
                {access.certificateTarget.preview.sequence} · Register sequence{' '}
                {access.certificateTarget.preview.registerSequence}
              </Text>
              <Action
                label="Confirm recipient certificate fulfilment"
                disabled={held}
                onPress={() => void access.fulfilCertificate()}
              />
              <Action label="Edit recipient certificate request" disabled={held} onPress={access.editCertificate} />
            </View>
          )}
          {access.requests.certificates.map((item) => (
            <View key={item.uuid} style={styles.group}>
              <Text style={styles.text}>
                Certificate request {item.uuid} · Member {item.member} · Entry {item.entry} · {item.status}
              </Text>
              {item.fulfilment && (
                <Text style={styles.muted}>
                  Unsigned PDF {item.fulfilment.uuid} · SHA-256 {item.fulfilment.digest} · {item.fulfilment.fileSize}{' '}
                  bytes
                </Text>
              )}
              {item.status === 'requested' && (
                <Action
                  label={`Preview recipient certificate ${item.uuid}`}
                  disabled={held || !!access.certificateTarget || !certificateInstruction.trim()}
                  onPress={() => void access.previewCertificate(item.uuid, certificateInstruction.trim())}
                />
              )}
            </View>
          ))}
        </>
      )}
    </Section>
  );
}
