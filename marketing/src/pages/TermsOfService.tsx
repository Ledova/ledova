import { PageHeader } from '../components/PageHeader';

export function TermsOfService() {
  return (
    <>
      <PageHeader title="Developer preview notice" lead="No hosted financial service is offered" />
      <section className="border-t border-rule">
        <div className="mx-auto max-w-3xl space-y-8 px-5 py-12 text-base leading-relaxed text-ink-muted md:px-8 lg:py-16">
          <p>
            Ledova is unaudited source-available software supplied under the Ledova Noncommercial License 1.0 for the
            permitted noncommercial purposes. It is not an exchange, custodian, broker, issuer, investment product, or
            financial service.
          </p>
          <p>
            Commercial use, including internal business use and paid services, and using the code for a competing
            product or service, even for free, require a separate written license. Developers are welcome to study, test
            and contribute under the{' '}
            <a
              href="https://github.com/Ledova/ledova/blob/main/LICENSE"
              className="font-medium text-ink underline decoration-rule-strong underline-offset-4"
            >
              repository license
            </a>
            .
          </p>
          <div>
            <h2 className="font-display text-2xl text-ink">Development use</h2>
            <p className="mt-2">
              Run the project locally or on supported public testnets with synthetic data and disposable keys. Do not
              use it with real funds, assets, identity documents, or production accounts.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-ink">No deployment representation</h2>
            <p className="mt-2">
              The repository does not identify or recommend live contracts, providers, reserves, legal entities, or
              regulated services. Operators are responsible for the terms and controls of their own deployment.
            </p>
          </div>
          <p>This page is a project-status notice, not legal advice or terms for a third-party deployment.</p>
        </div>
      </section>
    </>
  );
}
