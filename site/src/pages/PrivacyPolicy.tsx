import type { ReactNode } from 'react';
import { PageHeader } from '../components/PageHeader';
import { GITHUB_URL } from '../appLinks';
import { INLINE_LINK, PAGE_SECTION } from '../styles';

const CONTACT = (
  <a href="mailto:hello@ledova.io" className={INLINE_LINK}>
    hello@ledova.io
  </a>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-2xl text-text-primary">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

const LIST = 'list-disc space-y-2 pl-5';

const LABEL = 'font-medium text-text-primary';

export function PrivacyPolicy() {
  return (
    <>
      <PageHeader
        title="Privacy policy"
        lead="For the ledova.io preview and the public source code · Updated 9&nbsp;November&nbsp;2026"
      />
      <section className="border-t border-border-subtle">
        <div className={`${PAGE_SECTION} space-y-8 text-base leading-relaxed text-text-muted`}>
          <Section title="Who runs ledova.io">
            <p>
              Blueberry Money Pty Ltd (&ldquo;we&rdquo;) operates the experimental ledova.io preview. It is still for
              trying the software with fictional records, not for real company or personal information. Questions and
              privacy requests go to {CONTACT}.
            </p>
          </Section>
          <Section title="Use fictional data only">
            <p>
              The preview is for exploring Ledova with made-up companies and people. Don&apos;t enter real identity
              documents, financial details, private keys or other people&apos;s real personal information. The demo
              accounts in the{' '}
              <a href={`${GITHUB_URL}/blob/main/docs/demo-accounts.md`} className={INLINE_LINK}>
                project&apos;s guide
              </a>{' '}
              are shared publicly, so anyone can sign in to them and see or change what they hold.
            </p>
          </Section>
          <Section title="What we collect">
            <ul className={LIST}>
              <li>
                <strong className={LABEL}>When you register:</strong> your email address, a password (kept only as a
                one-way hash), and your full name, date of birth, phone number and residential address. Web and native
                signup do not ask for occupation, source of funds or intended use; earlier preview records can include
                these answers. Contact details support account and identity-check workflows; birth date supports
                configured identity checks, not company ownership calculations.
              </li>
              <li>
                <strong className={LABEL}>What you record:</strong> company details, share classes, holdings and awards,
                the names, addresses and email addresses of people you add or invite, and documents you upload. Earlier
                wallet and verification records can also remain in the system.
              </li>
              <li>
                <strong className={LABEL}>When you use the site:</strong> the server&apos;s logs record requests to the
                app and can include network addresses. Your network address and email address are also used for a short
                time to limit repeated sign-in and password-recovery attempts. Recovery also processes a temporary reset
                link and your replacement password; passwords are kept only as one-way hashes.
              </li>
              <li>
                <strong className={LABEL}>In your browser:</strong> cookies that keep you signed in and protect forms.
                Your browser also keeps your theme, the last company you opened, your email address while you sign up,
                and any invitation link you followed. There are no analytics, advertising or tracking cookies.
              </li>
            </ul>
          </Section>
          <Section title="How we use it">
            <p>
              To provide, secure and support Ledova: creating and securing accounts, showing each person the records
              their role allows, keeping each company&apos;s records, and finding and fixing problems. We don&apos;t
              sell personal information, use it for marketing or give it to anyone else for their own use. We don&apos;t
              collect tax file numbers.
            </p>
          </Section>
          <Section title="Where it's kept and who can see it">
            <ul className={LIST}>
              <li>
                The preview&apos;s application records are stored in Sydney, Australia, using Amazon Web Services. Email
                you send to hello@ledova.io is handled by Google Workspace.
              </li>
              <li>
                Company users see the records their company permissions allow; members see their own records. A company
                can also share ownership totals and share-class figures with its members, without revealing other
                holders&apos; names or private records. Companies don&apos;t see your account&apos;s phone number, date
                of birth or financial profile.
              </li>
              <li>
                Authorised operators can access private records only as needed for support, security or a lawful
                requirement.
              </li>
              <li>
                Outgoing preview messages are saved on the server rather than delivered. These include sign-up codes,
                member invitations and password-reset links. Delivery for real accounts has not been established; use a
                demo account instead.
              </li>
              <li>
                Apart from email you send us, no other service receives your information. Identity checks and payment
                services are switched off, push notifications aren&apos;t set up, and there is no error tracking.
              </li>
            </ul>
          </Section>
          <Section title="Retention and deletion">
            <p>
              Delete account in Settings ends sign-in immediately and erases unnecessary account details, including
              personal answers, identity-provider metadata, preferences, device tokens and inbox notifications. Minimal
              account references, Terms receipts, and specific retained transaction or legal-case records remain where
              needed to explain genuine history. Expired session records are removed by daily maintenance. Uncompleted
              signup information without protected history or a pending provider follow-up is erased after 30 days
              without activity. Unused uploads are eligible for cleanup after 24 hours; successful jobs after seven days
              and unsuccessful jobs after 30 days. Server logs rotate at their configured size limit.
            </p>
            <p>
              If an identity provider holds an applicant, deletion starts a separate permanent-erasure request. Our
              target is 30 days; the operator must obtain actual supplier confirmation. Pending applicant identifiers
              and the completion email are kept only for that follow-through, then cleared after confirmation and
              notice. An identified legal hold can delay specific deletion; we record its reason and review date.
              Reversible provider deactivation is not treated as deletion. Identity checks are currently off in the
              preview; if enabled, the configured provider is Sumsub or KYCAID, with its own notice and processing
              locations to be confirmed before real identity information is collected.
            </p>
            <p>
              Company records are separate from your sign-in. Their particulars, documents, decisions and copied history
              remain for the company’s identified recordkeeping purpose or a specific legal requirement or claim. The
              company is responsible for its legal register. Seven-year former-member retention is not a universal
              period for every copy Ledova holds. Authorised companies can obtain ledger exports and a company pack, and
              contact {CONTACT} to arrange exit and a review of records to keep or dispose of. Complete company disposal
              is not yet supported, and remains a gate before real records are admitted. The preview may still be reset;
              keep your own copies of useful test records.
            </p>
          </Section>
          <Section title="Access, correction and complaints">
            <p>
              Settings lets you update your personal details, download an account summary and initiate account deletion.
              The summary does not contain every record a company holds about you. A name or address change linked to a
              company register also updates that company’s particulars and retains the change history. Contact {CONTACT}{' '}
              for other access, correction, deletion or privacy requests. We will explain any retained records, reason
              or limit, and respond within 30 days or tell you why more time is needed. You can also raise a privacy
              complaint with the{' '}
              <a href="https://www.oaic.gov.au/privacy/privacy-complaints" className={INLINE_LINK}>
                Office of the Australian Information Commissioner
              </a>
              .
            </p>
          </Section>
          <Section title="Running Ledova yourself">
            <p>
              Ledova&apos;s source code is public. The project doesn&apos;t collect personal information because you
              download or run it, and this policy doesn&apos;t cover other deployments. If you deploy or modify the
              software, you&apos;re responsible for your own data practices, provider agreements, security controls,
              notices, retention rules and the law that applies to you. Use synthetic data and disposable credentials
              while testing.
            </p>
          </Section>
          <Section title="Changes">
            <p>
              We&apos;ll update this policy when the preview changes what it collects or how it&apos;s run, and change
              the date at the top. This policy explains how the preview works and isn&apos;t legal advice.
            </p>
          </Section>
        </div>
      </section>
    </>
  );
}
