export function TermsOfService() {
  return (
    <>
      <section className="pb-16 pt-24 lg:pt-32">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h1 className="text-4xl font-bold text-text-primary sm:text-5xl">Developer preview notice</h1>
          <p className="mt-4 text-lg text-text-muted">No hosted financial service is offered</p>
        </div>
      </section>
      <section className="border-t border-border-subtle bg-surface-raised/50 py-24">
        <div className="mx-auto max-w-3xl space-y-8 px-6 leading-relaxed text-text-muted">
          <p>
            Ledova is unaudited source-available software supplied under the Ledova Noncommercial License 1.0 for the
            permitted noncommercial purposes. It is not an exchange, custodian, broker, issuer, investment product, or
            financial service.
          </p>
          <p>
            Commercial use, including internal business use and paid services, and using the code for a competing
            product or service, even for free, require a separate written license. Developers are welcome to study, test
            and contribute under the{' '}
            <a href="https://github.com/Ledova/ledova/blob/main/LICENSE" className="underline">
              repository license
            </a>
            .
          </p>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Development use</h2>
            <p className="mt-2">
              Run the project locally or on supported public testnets with synthetic data and disposable keys. Do not
              use it with real funds, assets, identity documents, or production accounts.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">No deployment representation</h2>
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
