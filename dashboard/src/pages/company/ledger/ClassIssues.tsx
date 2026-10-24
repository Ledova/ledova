import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrderSubmissionOwner, TokenHoldersResponse } from '@ledova/shared';
import { Choices } from '@components/Choices';
import { Section } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { useInvestorIssues } from './useInvestorIssues';
import { useNonPaidIssues } from './useNonPaidIssues';
import { useIssueFreshness } from './useIssueFreshness';

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
  const [preparing, setPreparing] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<HTMLDivElement | null>(null);
  const reviewChanged = useCallback((uuid: string, open: boolean) => {
    setReviewing((current) => (open ? uuid : current === uuid ? null : current));
  }, []);
  const [returnToAction, setReturnToAction] = useState(false);
  const prepareAction = useRef<HTMLButtonElement>(null);
  const preparation = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<IssueKind | ''>('');
  const [award, setAward] = useState<string | undefined>();
  const [member, setMember] = useState<string | undefined>();
  const [answered, setAnswered] = useState('');
  const close = (recorded = false) => {
    setPreparing(false);
    setReturnToAction(!recorded);
    setKind('');
    setAward(undefined);
    setMember(undefined);
  };
  useEffect(() => {
    if (visible && preparing) preparation.current?.focus();
  }, [visible, preparing]);
  const investor = useInvestorIssues({
    owner,
    company,
    register,
    guard,
    sourceReady,
    visible,
    onHeldChange: onAllotmentHeld,
    issueMember: member,
    open: preparing && kind === 'investor',
    kept: preparing,
    onClosed: close,
    reviewTarget,
    onReviewChange: reviewChanged,
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
    open: preparing && kind === 'nonpaid',
    kept: preparing,
    onClosed: close,
  });
  useIssueFreshness({
    owner,
    company,
    token: register.token.uuid,
    guard,
    visible,
    sourceReady,
    refreshRecords: () => Promise.allSettled([investor.refreshRecords(), nonPaid.refreshRecords()]),
  });
  const held = investor.held || nonPaid.held;
  useEffect(() => {
    if (visible && !preparing && returnToAction && sourceReady && prepareAction.current) {
      prepareAction.current.focus();
      setReturnToAction(false);
    }
  }, [visible, preparing, returnToAction, sourceReady, investor.prepare]);
  if (request && answered !== request.key && !held) {
    setAnswered(request.key);
    if (request.award || request.member) {
      setPreparing(true);
      setReturnToAction(false);
      setKind(request.award ? 'nonpaid' : 'investor');
      setAward(request.award);
      setMember(request.member);
    }
  }
  const grouped = !investor.empty && !nonPaid.empty;
  const status = (
    <>
      {investor.status}
      {nonPaid.status}
    </>
  );
  const browsing = !preparing && !reviewing;
  return (
    <div role="region" aria-label="Share issue workflow" className="space-y-5">
      {investor.setup}
      <div hidden={!browsing}>
        <Section title="Share issues">
          {browsing && status}
          {investor.empty && nonPaid.empty && <p className="text-sm text-text-muted">No share issues recorded yet.</p>}
          <div hidden={investor.empty}>{investor.records}</div>
          <div hidden={nonPaid.empty} className={grouped ? 'border-t border-border-subtle' : undefined}>
            {nonPaid.records}
          </div>
        </Section>
      </div>
      {investor.prepare && browsing && (
        <div className="flex flex-wrap justify-end gap-2">
          <PageAction
            ref={prepareAction}
            label="Prepare issue"
            primary
            disabled={held || !sourceReady}
            onClick={() => {
              setReturnToAction(false);
              setPreparing(true);
            }}
          />
        </div>
      )}
      <div hidden={!reviewing} className="space-y-5">
        {reviewing && status}
        <div ref={setReviewTarget} />
      </div>
      <div ref={preparation} tabIndex={-1} hidden={!preparing} className="focus:outline-none">
        <Section title="Prepare share issue">
          {preparing && status}
          <Choices legend="What kind of issue?" options={KINDS} value={kind} disabled={held} onChange={setKind} />
          {investor.form}
          {nonPaid.form}
          {!kind && (
            <FormActions>
              <PageAction label="Cancel" disabled={held} onClick={() => close()} />
            </FormActions>
          )}
        </Section>
      </div>
    </div>
  );
}
