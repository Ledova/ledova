import { useState } from 'react';
import type { OrderSubmissionOwner, TokenHoldersResponse } from '@ledova/shared';
import { Choices } from '@components/Choices';
import { PageAction } from '@components/Page';
import { useInvestorIssues } from './useInvestorIssues';
import { useNonPaidIssues } from './useNonPaidIssues';

const KINDS = [
  ['investor', 'Investor issue'],
  ['nonpaid', 'Non-paid issue'],
] as const;

type IssueKind = (typeof KINDS)[number][0];

export interface IssueRequest {
  key: string;
  member?: string;
  award?: string;
  record?: string;
}

export function ClassIssues({
  owner,
  company,
  register,
  guard,
  sourceReady,
  visible,
  onAllotmentHeld,
  onGrantHeld,
  request,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  visible: boolean;
  onAllotmentHeld: (token: string, held: boolean) => void;
  onGrantHeld: (token: string, held: boolean) => void;
  request?: IssueRequest;
}) {
  const [kind, setKind] = useState<IssueKind | ''>('');
  const [award, setAward] = useState<string | undefined>();
  const [answered, setAnswered] = useState('');
  const close = () => {
    setKind('');
    setAward(undefined);
  };
  const investor = useInvestorIssues({
    owner,
    company,
    register,
    guard,
    sourceReady,
    visible,
    onHeldChange: onAllotmentHeld,
    issueMember: request?.member,
    open: kind === 'investor',
    onClosed: close,
  });
  const nonPaid = useNonPaidIssues({
    owner,
    company,
    register,
    guard,
    sourceReady,
    visible,
    onHeldChange: onGrantHeld,
    award,
    focusRecord: request?.record ? { key: request.key, uuid: request.record } : undefined,
    open: kind === 'nonpaid',
    onClosed: close,
  });
  const held = investor.held || nonPaid.held;
  if (request && answered !== request.key && !held) {
    setAnswered(request.key);
    if (request.award || request.member) {
      setKind(request.award ? 'nonpaid' : 'investor');
      setAward(request.award);
    }
  }
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      {investor.setup}
      {investor.prepare && (
        <>
          <Choices
            legend="What kind of issue?"
            options={KINDS}
            value={kind}
            disabled={investor.blocked || held}
            onChange={(next) => {
              setKind(next);
              setAward(undefined);
            }}
          />
          <p className="text-sm text-text-muted">
            An investor issue is paid in money, with the agreement and the company’s receipt. A non-paid issue has no
            payment and follows the company’s terms, such as vested award shares.
          </p>
        </>
      )}
      {kind && <PageAction label="Close issue form" disabled={held} onClick={close} />}
      {investor.form}
      {nonPaid.form}
      {investor.records}
      {nonPaid.records}
    </div>
  );
}
