import { CheckboxField, Field, TextArea, TextInput } from '@components/Field';
import { Disclosure, Row, Rows, Section, Status } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { ErrorSummary } from '@components/ErrorSummary';
import { MemberRecordsContent } from '@components/member-records/MemberRecordsContent';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useRunningAction } from '@hooks/useRunningAction';
import { FIELD_LIMITS, MEMBER_PARTICULARS_STATUS_LABELS, formatDate, shortReference } from '@ledova/shared';

export function CompanyRecordedDetails() {
  const { read } = useMemberWorkspace();
  return (
    <PageTitle.Provider value="Company-recorded details">
      <Page lede="Details held by the company, separate from your personal profile.">
        <MemberRecordsContent>{read.record && <MemberParticulars key={read.record.uuid} />}</MemberRecordsContent>
      </Page>
    </PageTitle.Provider>
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
        <div key={request.uuid} className="py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <p className="text-text-muted">{formatDate(request.createdAt, 'Date not recorded')}</p>
            <Status tone={request.status === 'applied' ? 'done' : request.status === 'rejected' ? 'closed' : 'waiting'}>
              {MEMBER_PARTICULARS_STATUS_LABELS[request.status]}
            </Status>
          </div>
          <Rows>
            <Row label="Name">{request.name}</Row>
            <Row label="Residential address">
              <span className="whitespace-pre-line">{request.residentialAddress}</span>
            </Row>
          </Rows>
          <Disclosure summary="Record details">
            <Rows>
              <Row label="Request">{shortReference(request.uuid)}</Row>
              {request.change && <Row label="Company instruction">{shortReference(request.change)}</Row>}
            </Rows>
          </Disclosure>
        </div>
      ))}
    </div>
  );
  return (
    read.record && (
      <>
        <Section title={particularsOpen ? 'Request update' : 'Current details'}>
          {particularsOpen ? (
            <form
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
              <Rows>
                <Row label="Name">{read.record.name}</Row>
                <Row label="Residential address">
                  <span className="whitespace-pre-line">{read.record.residentialAddress}</span>
                </Row>
              </Rows>
              <Disclosure summary="Ledger details">
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
              </Disclosure>
              <FormActions>
                <PageAction
                  label="Request update"
                  disabled={held}
                  onClick={() => setDraft((value) => ({ ...value, open: true }))}
                />
              </FormActions>
            </>
          )}
        </Section>
        {!particularsOpen && (pendingParticulars.length > 0 || previousParticulars.length > 0) && (
          <Section title="Update requests">
            {pendingParticulars.length > 0 && particularsRequests(pendingParticulars)}
            {previousParticulars.length > 0 && (
              <Disclosure summary="Previous requests">{particularsRequests(previousParticulars)}</Disclosure>
            )}
          </Section>
        )}
      </>
    )
  );
}
