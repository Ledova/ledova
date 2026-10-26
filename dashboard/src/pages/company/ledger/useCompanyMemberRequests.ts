import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getRegisterAwards,
  isRegisterEvidenceReceipt,
  readEveryPage,
  uploadRegisterEvidence,
  useCompanyMemberAccess,
  type RegisterEvidence,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
  failureSentence,
  isCalendarDate,
  utcToday,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { type Problems } from '@hooks/useErrorSummary';
import { invitationMembers } from '@ledova/shared';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { particularsKey } from '@pages/company/ledger/shared/useRegisterParticulars';

type MemberField = 'member' | 'email' | 'reason' | 'file' | 'asAt' | 'instruction';

export const INVITATION_FIELDS: readonly MemberField[] = ['member', 'email'];
export const PARTICULARS_FIELDS: readonly MemberField[] = ['file', 'asAt', 'reason'];

export function useCompanyMemberRequests({
  company,
  owner,
  guard,
  registers,
  sourceReady = true,
  inviteMember = '',
}: {
  company: string;
  owner: OrderSubmissionOwner;
  guard: () => void;
  registers: TokenHoldersResponse[];
  sourceReady?: boolean;
  inviteMember?: string;
}) {
  const access = useCompanyMemberAccess(
    company,
    () => crypto.randomUUID(),
    undefined,
    sourceReady,
    particularsKey(owner, company),
    'email',
  );
  const guardRecipients = () => {
    guard();
    access.guardPrepare();
  };
  const awards = useQuery({
    queryKey: [...registerKey(owner), 'invitation-awards', company],
    enabled: !!access.admin && !!access.prepare && sourceReady,
    queryFn: () =>
      readEveryPage(async (page) => {
        guardRecipients();
        const response = await getRegisterAwards(
          apiClient,
          { company, page },
          { ledovaSubmissionGuard: guardRecipients },
        );
        guardRecipients();
        return response;
      }),
    ...READ_TIMING,
  });
  let candidates = [] as ReturnType<typeof invitationMembers>;
  let recipientsError = '';
  if (access.admin && sourceReady && awards.isSuccess && !awards.isFetching) {
    try {
      candidates = invitationMembers(registers, awards.data, company);
    } catch (failure) {
      recipientsError = failure instanceof Error ? failure.message : 'The company recipients could not be confirmed.';
    }
  }
  const recipientsReady = !!access.admin && sourceReady && awards.isSuccess && !awards.isFetching && !recipientsError;
  const [invitation, setInvitation] = useState({ company, member: inviteMember, email: '' });
  const member = invitation.company === company ? candidates.find(({ uuid }) => uuid === invitation.member) : undefined;
  const email = invitation.company === company ? invitation.email : '';
  const memberName = (uuid: string) =>
    candidates.find((candidate) => candidate.uuid === uuid)?.name ||
    registers.flatMap((register) => register.holders).find((holder) => holder.member === uuid)?.name ||
    'Company member';
  if (invitation.company !== company || (recipientsReady && invitation.member && !member))
    setInvitation({ company, member: '', email: '' });
  const [reason, setReason] = useState('');
  const [request, setRequest] = useState('');
  const [certificateInstruction, setCertificateInstruction] = useState('');
  const [asAt, setAsAt] = useState(utcToday());
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploaded = useRef<{ file: File; appointment: string; key: string; receipt: RegisterEvidence | null } | null>(
    null,
  );
  const selectFile = (selected: File | null) => {
    setFile(selected);
    uploaded.current = null;
  };
  const held = access.busy || uploading || !!access.retry;
  const preparing =
    !!access.prepare &&
    !!access.requests?.particulars.some((item) => item.uuid === request && item.status === 'submitted');
  const problems: Problems<MemberField> = {
    member: !member && 'Choose the member or award recipient.',
    email: !email.trim() && 'Give the intended recipient’s email.',
    reason: (!!access.admin || preparing) && !reason.trim() && 'Give the company action reason.',
    file: preparing && !file && 'Choose the company supporting document.',
    asAt: preparing && (!isCalendarDate(asAt) || asAt > utcToday()) && 'Enter an as-at date no later than today (UTC).',
    instruction: !certificateInstruction.trim() && 'Give the certificate instruction reference.',
  };
  const refresh = async () => {
    await access.refresh();
    await awards.refetch();
  };
  const prepare = async () => {
    if (!file || !access.prepare || !preparing || uploading || PARTICULARS_FIELDS.some((key) => problems[key])) return;
    setUploading(true);
    setUploadError('');
    try {
      access.guardPrepare();
      const appointment = access.prepare.uuid;
      if (uploaded.current?.file !== file || uploaded.current.appointment !== appointment)
        uploaded.current = { file, appointment, key: crypto.randomUUID(), receipt: null };
      const current = uploaded.current;
      const evidenceRequest = {
        companyId: company,
        appointment,
        kind: 'supporting' as const,
        idempotencyKey: current.key,
      };
      if (!current.receipt) {
        const { data } = await uploadRegisterEvidence(
          apiClient,
          { ...evidenceRequest, file },
          { ledovaSubmissionGuard: access.guardPrepare },
        );
        access.guardPrepare();
        if (!isRegisterEvidenceReceipt(data, evidenceRequest, file.size))
          throw new Error('The company evidence upload could not be confirmed.');
        current.receipt = data;
      }
      await access.prepareRequest(request, current.receipt.uuid, asAt, reason.trim());
    } catch (failure) {
      setUploadError(failureSentence(failure, 'The supporting document could not be uploaded.'));
    } finally {
      setUploading(false);
    }
  };
  return {
    access,
    awards,
    candidates,
    recipientsError,
    recipientsReady,
    member,
    email,
    memberName,
    setInvitation,
    reason,
    setReason,
    request,
    setRequest,
    certificateInstruction,
    setCertificateInstruction,
    asAt,
    setAsAt,
    selectFile,
    uploading,
    uploadError,
    held,
    problems,
    refresh,
    prepare,
  };
}
