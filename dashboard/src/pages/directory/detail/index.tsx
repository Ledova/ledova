import { DIRECTORY_OFFERING_TONES } from '@pages/directory/shared/presentation';
import { useState } from 'react';
import { generatePath, useNavigate, useParams } from 'react-router-dom';
import {
  DESTINATIONS,
  OFFER_DOCUMENT_COPY,
  describeOfferDocument,
  formatMoney,
  formatShareCount,
  useDirectoryDocuments,
  useDirectoryToken,
  useSubscribableWallets,
  type DirectoryDocument,
  formatDateTime,
} from '@ledova/shared';
import { Row, Rows, Section, Status, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
import { SubscribeForm } from './SubscribeForm';
import { useCreateSubscription } from './useCreateSubscription';

function OfferDocuments({ read }: { read: ReturnType<typeof useDirectoryDocuments> }) {
  return (
    <Section title={OFFER_DOCUMENT_COPY.TITLE}>
      {read.isLoading ? (
        <Loading>{OFFER_DOCUMENT_COPY.LOADING}</Loading>
      ) : read.hasError ? (
        <LoadError retry={read.retry} busy={read.isRefreshing}>
          {OFFER_DOCUMENT_COPY.FAILED}
        </LoadError>
      ) : read.documents.length === 0 ? (
        <p className="py-2 text-sm text-text-muted">{OFFER_DOCUMENT_COPY.EMPTY}</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">{OFFER_DOCUMENT_COPY.HELP}</p>
          <ul className="divide-y divide-border-subtle">
            {read.documents.map((document: DirectoryDocument) => (
              <li key={document.uuid} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-all text-text-primary">{document.name}</p>
                  <p className="text-text-muted">{describeOfferDocument(document)}</p>
                </div>
                <a
                  href={document.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${OFFER_DOCUMENT_COPY.VIEW} ${document.name}`}
                  className="text-brand-light underline"
                >
                  {OFFER_DOCUMENT_COPY.VIEW}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export default function DirectoryTokenPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<{ offering: string; quantity: string; wallet: string | null } | null>(null);
  const {
    token,
    operator,
    isLoading,
    notFound,
    hasError,
    retry,
    isRefreshing,
    operatorLoading,
    operatorFailed,
    operatorRefreshing,
    retryOperator,
  } = useDirectoryToken(uuid);
  const wallets = useSubscribableWallets(Boolean(token?.openOffering) && !hasError && !notFound);
  const documents = useDirectoryDocuments(uuid, Boolean(token) && !hasError && !notFound);
  const create = useCreateSubscription((created) =>
    navigate(generatePath(DESTINATIONS.subscriptionDetail.path, { uuid: created })),
  );

  if (isLoading) return <Page narrow loading />;

  if (hasError) {
    return (
      <Page narrow>
        <LoadError retry={retry} busy={isRefreshing}>
          This share class could not be loaded.
        </LoadError>
      </Page>
    );
  }

  if (!token || notFound) {
    return (
      <Page narrow>
        <Section title="Share class not available">
          <p className="py-2 text-sm text-text-muted">
            This share class is not available to you in the directory. It may have closed or your investor status may
            need updating.
          </p>
        </Section>
      </Page>
    );
  }

  const offering = token.openOffering;

  return (
    <Page narrow lede={token.company.displayName}>
      <div className="min-w-0 break-words">
        <Section title={token.name}>
          <Rows>
            <Row label="Symbol">{token.symbol}</Row>
            <Row label="Authorised shares">
              <span className="break-all">{formatShareCount(token.totalSupply)}</span>
            </Row>
            <Row label="Shares issued">
              {Number.isSafeInteger(token.issuedShares) && token.issuedShares >= 0
                ? formatShareCount(String(token.issuedShares))
                : 'Unavailable'}
            </Row>
            {token.company.industry && <Row label="Industry">{token.company.industry}</Row>}
            {[token.company.city, token.company.state].some(Boolean) && (
              <Row label="Location">{[token.company.city, token.company.state].filter(Boolean).join(', ')}</Row>
            )}
          </Rows>
        </Section>
      </div>
      <Section title="Current offering">
        <p className="py-2 text-sm text-text-primary">
          <Status tone={DIRECTORY_OFFERING_TONES.get(!!offering)!}>
            {offering ? 'Open for applications' : 'No offering open'}
          </Status>
        </p>
        {offering ? (
          <Rows>
            <Row label="Price per share">
              <span className="break-all">{formatMoney(offering.pricePerShare, offering.priceCurrency)}</span>
            </Row>
            <Row label="Opened">{formatDateTime(offering.opensAt)}</Row>
            <Row label="Closes">{offering.closesAt ? formatDateTime(offering.closesAt) : 'No closing date'}</Row>
          </Rows>
        ) : (
          <p className="text-sm text-text-muted">
            An offering will appear here when the operator has approved it and its opening time has arrived.
          </p>
        )}
      </Section>
      <OfferDocuments read={documents} />
      {offering &&
        (wallets.isLoading ? (
          <Loading>Loading your receiving wallets…</Loading>
        ) : wallets.hasError ? (
          <LoadError retry={wallets.retry} busy={wallets.isRefreshing}>
            Your receiving wallets could not be loaded.
          </LoadError>
        ) : (
          <SubscribeForm
            key={offering.uuid}
            offering={offering}
            draft={draft?.offering === offering.uuid ? draft : { quantity: '', wallet: null }}
            onDraftChange={(updated) => setDraft({ ...updated, offering: offering.uuid })}
            wallets={wallets.wallets}
            busy={create.isPending}
            error={create.error}
            onSubscribe={({ wallet, quantity }) => create.mutate({ offering: offering.uuid, wallet, quantity })}
          />
        ))}
      <Section title="Payments">
        {operatorLoading ? (
          <Loading>Loading operator details…</Loading>
        ) : operatorFailed ? (
          <LoadError retry={retryOperator} busy={operatorRefreshing}>
            Operator details could not be loaded.
          </LoadError>
        ) : (
          <p className="py-2 text-sm text-text-muted">
            {operator?.name ?? 'The operator'} reviews your application. After it is accepted, open the application for
            the exact amount and payment reference. Creating a draft does not send a payment.
          </p>
        )}
      </Section>
    </Page>
  );
}
