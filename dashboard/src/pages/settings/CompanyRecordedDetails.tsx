import { CheckboxField, Field, TextArea, TextInput } from '@components/Field';
import { ShowMore, Row, Rows, Section, Status } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { MemberRecordsContent } from '@components/member-records/MemberRecordsContent';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useRunningAction } from '@hooks/useRunningAction';
import { FIELD_LIMITS, MEMBER_PARTICULARS_STATUS_LABELS, formatDate } from '@ledova/shared';

export function CompanyRecordedDetails() {
  const { read } = useMemberWorkspace();
  return (
    <Section title="Company-recorded details">
      <MemberRecordsContent>{read.record && <MemberParticulars key={read.record.uuid} />}</MemberRecordsContent>
    </Section>
  );
}

function MemberParticulars() {
  const { read, held, draft, setDraft } = useMemberWorkspace();
  const { name, address, confirmed, open: particularsOpen } = draft;
  const { running, track } = useRunningAction();
  const setName = (name: string) => setDraft((value) => ({ ...value, name }));
  const setAddress = (address: string) => setDraft((value) => ({ ...value, address }));
  const setConfirmed = (confirmed: boolean) => setDraft((value) => ({ ...value, confirmed }));
  const particularsChecks = useErrorSummary({
    name: !name.trim() && 'Give the requested name.',
    address: !address.trim() && 'Give the requested residential address.',
    confirmed: !confirmed && 'Confirm sharing these particulars with the company.',
  });
  const pendingParticulars =
    read.requests?.particulars.filter((request) => request.status !== 'applied' && request.status !== 'rejected') ?? [];
  const previousParticulars =
    read.requests?.particulars.filter((request) => request.status === 'applied' || request.status === 'rejected') ?? [];
  const particularsRequests = (requests: NonNullable<typeof read.requests>['particulars']) => (
    <div className="divide-y divide-border-subtle text-sm">
      {requests.map((request) => (
        <div key={request.uuid} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
          <Rows>
            <Row label="Name">{request.name}</Row>
            <Row label="Residential address">
              <span className="whitespace-pre-line break-words">{request.residentialAddress}</span>
            </Row>
            <Row label="Status">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Status
                  tone={request.status === 'applied' ? 'done' : request.status === 'rejected' ? 'closed' : 'waiting'}
                >
                  {MEMBER_PARTICULARS_STATUS_LABELS[request.status]}
                </Status>
                <span className="text-text-muted">{formatDate(request.createdAt, 'Date not recorded')}</span>
              </div>
            </Row>
          </Rows>
        </div>
      ))}
    </div>
  );
  return (
    read.record && (
      <>
        {particularsOpen ? (
          <form
            data-member-draft
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!held && particularsChecks.check())
                track('particulars', read.requestParticulars(name.trim(), address.trim()));
            }}
          >
            <p className="text-sm text-text-muted">The company reviews your request before updating its records.</p>
            <ErrorSummary {...particularsChecks.summary} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field {...particularsChecks.field('name')} label="Requested name">
                <TextInput
                  maxLength={FIELD_LIMITS.NAME}
                  value={name}
                  disabled={held}
                  onChange={(event) => {
                    setName(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </Field>
              <Field {...particularsChecks.field('address')} label="Requested residential address">
                <TextArea
                  rows={3}
                  maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
                  value={address}
                  disabled={held}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </Field>
            </div>
            <CheckboxField
              {...particularsChecks.field('confirmed')}
              label="Share these requested particulars with this company for review."
              checked={confirmed}
              disabled={held}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <FormActions>
              <PageAction
                label="Cancel"
                disabled={held}
                onClick={() => setDraft((value) => ({ ...value, open: false }))}
              />
              <PageAction
                type="submit"
                label="Send request"
                primary
                busy={running === 'particulars'}
                busyLabel="Sending request…"
                disabled={held}
              />
            </FormActions>
          </form>
        ) : (
          <>
            <p className="text-sm text-text-muted">
              Held by {read.record.company.name} in its register, separate from your personal information.
            </p>
            <div
              className={`grid gap-6 ${pendingParticulars.length > 0 || previousParticulars.length > 0 ? 'lg:grid-cols-2' : ''}`}
            >
              <div className="flex min-w-0 flex-col gap-3">
                <h3 className="text-sm font-medium">Current details</h3>
                <Rows>
                  <Row label="Name">{read.record.name}</Row>
                  <Row label="Residential address">
                    <span className="whitespace-pre-line break-words">{read.record.residentialAddress}</span>
                  </Row>
                </Rows>
                <div className="text-sm lg:mt-auto">
                  <ShowMore show="Show ledger details" hide="Hide ledger details">
                    <p className="text-sm text-text-muted">
                      Provided by the company, not verified by Ledova. Profile edits do not change this register.
                    </p>
                    {read.record.classes.map((item) => (
                      <p key={item.uuid} className="py-2 text-sm text-text-muted">
                        {item.name} · Entered {formatDate(item.enteredOn, 'Not recorded')}
                        {item.ceasedOn ? ` · Ceased ${formatDate(item.ceasedOn)}` : ''} · Amount paid{' '}
                        {item.amountPaid ?? 'not recorded'}
                      </p>
                    ))}
                  </ShowMore>
                </div>
              </div>
              {(pendingParticulars.length > 0 || previousParticulars.length > 0) && (
                <div className="flex min-w-0 flex-col gap-3 border-t border-border-subtle pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                  <h3 className="text-sm font-medium">Update requests</h3>
                  {pendingParticulars.length > 0 && particularsRequests(pendingParticulars)}
                  {previousParticulars.length > 0 && (
                    <ShowMore
                      show={`Show previous requests (${previousParticulars.length})`}
                      hide="Hide previous requests"
                    >
                      {particularsRequests(previousParticulars)}
                    </ShowMore>
                  )}
                </div>
              )}
            </div>
            <FormActions>
              <PageAction
                label="Request update"
                disabled={held}
                onClick={() => setDraft((value) => ({ ...value, open: true }))}
              />
            </FormActions>
          </>
        )}
      </>
    )
  );
}
