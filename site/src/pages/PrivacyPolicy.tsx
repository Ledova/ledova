import { PageHeader } from '../components/PageHeader';

export function PrivacyPolicy() {
  return (
    <>
      <PageHeader title="Developer preview privacy notice" lead="For the public repository, not a hosted service" />
      <section className="border-t border-border-subtle">
        <div className="mx-auto max-w-3xl space-y-8 px-5 py-16 text-base leading-relaxed text-text-muted md:px-8 lg:py-20">
          <p>
            Ledova is experimental software. The project does not provide a hosted production service and does not
            collect personal information merely because you download or run the source code.
          </p>
          <div>
            <h2 className="font-display text-2xl text-text-primary">Run it safely</h2>
            <p className="mt-2">
              Use synthetic data and disposable credentials. Do not submit real identity documents, financial data,
              private keys, or personal information to a development deployment.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-text-primary">Self-hosted deployments</h2>
            <p className="mt-2">
              Anyone who deploys or modifies the software is responsible for their own data practices, provider
              agreements, security controls, notices, retention rules, and applicable law.
            </p>
          </div>
          <p>This template is informational and is not legal advice or a privacy policy for your deployment.</p>
        </div>
      </section>
    </>
  );
}
