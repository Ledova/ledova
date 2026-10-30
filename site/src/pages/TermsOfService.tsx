import { PageHeader } from '../components/PageHeader';
import { INLINE_LINK, PAGE_SECTION } from '../styles';

export function TermsOfService() {
  return (
    <>
      <PageHeader title="Terms of Service" lead="Experimental-use terms · Version 2026-10-14" />
      <section className="border-t border-border-subtle">
        <div className={`${PAGE_SECTION} space-y-8 text-base leading-relaxed text-text-muted`}>
          <p>
            These terms apply to the experimental Ledova workspace. By completing registration, you accept this version.
            Ledova provides software and tools; companies manage their own share information and decisions.
          </p>
          <div>
            <h2 className="font-display text-2xl text-text-primary">Company authority and team access</h2>
            <p className="mt-2">
              When registering a company workspace, you confirm that you are authorised to set it up and administer it,
              including managing its users, and to accept these terms on the company&apos;s behalf. You must have that
              authority already; accepting these terms does not create it. Use your own account, protect its credentials
              and invite only people authorised for the company permissions you give them.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-text-primary">Company responsibility</h2>
            <p className="mt-2">
              Company and share information is provided by the company. Keep it accurate and upload relevant documents
              when needed after registration. The company remains responsible for its register, share arrangements,
              approvals, records, ASIC filings and legal obligations. Information stored in Ledova is not thereby
              verified by Ledova.
            </p>
            <p className="mt-2">
              Copied existing-register records mirror the company&apos;s supplied ownership information. The company
              keeps its legal register, historical records, lawful register access arrangements and filings. Copying
              records into Ledova does not replace those arrangements or establish legal ownership.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-text-primary">Registration and company decisions</h2>
            <p className="mt-2">
              Registration creates a software workspace. It does not incorporate a company with ASIC, appoint a
              director, activate the company or issue shares. Each share issue, allotment, transfer and other supported
              company action needs its own applicable company authority, approval and evidence. An award is an
              entitlement, not issued shares, and a payment or receipt alone does not issue shares.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-text-primary">Experimental use</h2>
            <p className="mt-2">
              The software is experimental and unaudited. Use synthetic data, disposable credentials and supported
              testnets only. Do not submit real funds, securities, identity documents or personal data. Connected
              providers retain their own terms and checks; registration does not satisfy those checks or guarantee legal
              or regulatory compliance. These terms provide no legal, investment or tax advice.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-text-primary">Software licence and other deployments</h2>
            <p className="mt-2">
              The{' '}
              <a href="https://github.com/Ledova/ledova/blob/main/LICENSE" className={INLINE_LINK}>
                Ledova Noncommercial License 1.0
              </a>{' '}
              governs use of the source code. Commercial use, including internal business use and paid services, and a
              competing product or service require separate written permission. These workspace terms grant no
              additional software rights. Operators of other deployments must identify themselves and provide terms,
              data practices and controls appropriate to their actual services and applicable law.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
