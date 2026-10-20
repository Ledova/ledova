import { CompanyPicker } from '@components/CompanyPicker';
import { Outcome, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { useSubmissionOwner, useUserPreferences, type OrderSubmissionOwner, apiErrorSentence } from '@ledova/shared';
import { AuthorityRequestForm } from './AuthorityRequestForm';
import { AuthorityRequestRecord } from './AuthorityRequestRecord';
import { useAuthorityRequests } from './useAuthorityRequests';

const DOWNLOAD_FAILED = 'Your evidence could not be downloaded.';
const OUTCOME_UNCONFIRMED = 'Your request outcome could not be confirmed. Refresh or retry.';

export default function CompanyAuthorityPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (!owner)
    return (
      <Page narrow>
        <p className="text-sm text-text-muted">
          Verify your signed-in account before opening representative authority.
        </p>
        {preferences.isError && <PageAction label="Retry your account" onClick={() => void preferences.refetch()} />}
      </Page>
    );
  return (
    <OwnAuthorityRequests
      key={`${owner.userUuid}/${owner.ownerAccountUuid}`}
      owner={owner}
      currentOwner={boundary.get}
    />
  );
}

function OwnAuthorityRequests({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const {
    guard,
    selected,
    setSelected,
    recorded,
    setRecorded,
    companies,
    history,
    drafts,
    company,
    lifecycle,
    opening,
  } = useAuthorityRequests({
    owner,
    currentOwner,
  });
  return (
    <Page narrow>
      <p className="text-sm text-text-muted">
        Establish your representative appointment by accepting an authorisation declaration for your company. Company
        information is provided by the company. Submitting evidence alone grants no authority.
      </p>
      <Section title="New authority request">
        {companies.isLoading ? (
          <p role="status" className="text-sm text-text-muted">
            Loading your companies…
          </p>
        ) : companies.isError ? (
          <div role="alert" className="space-y-2 text-sm text-error-light">
            <p>Your companies could not be loaded.</p>
            <PageAction
              label="Retry companies"
              onClick={() => void companies.refetch()}
              disabled={companies.isFetching}
            />
          </div>
        ) : drafts.length === 0 ? (
          <p className="text-sm text-text-muted">No draft company is available for an authority request.</p>
        ) : (
          <CompanyPicker
            companies={drafts.map((item) => ({ uuid: item.uuid, name: item.name, detail: `Draft · ACN ${item.acn}` }))}
            value={selected}
            disabled={companies.isFetching}
            onChange={(uuid) => {
              setSelected(uuid);
              setRecorded(null);
            }}
          />
        )}
        {recorded ? (
          <div className="space-y-2">
            <Outcome>Request recorded. {recorded.verificationMessage}</Outcome>
            <PageAction label="Start another request" onClick={() => setRecorded(null)} />
          </div>
        ) : (
          company && (
            <AuthorityRequestForm
              key={company.uuid}
              company={company}
              disabled={companies.isFetching}
              guard={guard}
              onSuccess={(request) => {
                guard();
                setRecorded(request);
                void history.refetch();
              }}
            />
          )
        )}
      </Section>
      <Section title="Your request history">
        {history.isLoading ? (
          <p role="status" className="text-sm text-text-muted">
            Loading your requests…
          </p>
        ) : history.isError ? (
          <div role="alert" className="space-y-2 text-sm text-error-light">
            <p>Your authority requests could not be loaded.</p>
            <PageAction
              label="Retry request history"
              onClick={() => void history.refetch()}
              disabled={history.isFetching}
            />
          </div>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No authority requests recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(history.data ?? []).map((request) => (
              <AuthorityRequestRecord
                key={request.uuid}
                request={request}
                blocked={lifecycle.isPending || history.isFetching}
                opening={opening.isPending}
                action={
                  lifecycle.isPending && lifecycle.variables?.request.uuid === request.uuid
                    ? lifecycle.variables.action
                    : undefined
                }
                onDownload={() => opening.mutate(request)}
                onWithdraw={() => lifecycle.mutateAsync({ request, action: 'withdraw' })}
                onAdmit={() => lifecycle.mutate({ request, action: 'admit' })}
                onRevoke={() => lifecycle.mutateAsync({ request, action: 'revoke' })}
              />
            ))}
          </ul>
        )}
        {opening.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(opening.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
          </p>
        )}
        {lifecycle.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(lifecycle.error, OUTCOME_UNCONFIRMED, OUTCOME_UNCONFIRMED)}
          </p>
        )}
      </Section>
    </Page>
  );
}
