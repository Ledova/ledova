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
        lead={'For the ledova.io preview and the public source code · Updated 30 October 2026'}
      />
      <section className="border-t border-border-subtle">
        <div className={`${PAGE_SECTION} space-y-8 text-base leading-relaxed text-text-muted`}>
          <Section title="Who runs ledova.io">
            <p>
              ledova.io is an experimental preview of Ledova, run by the Ledova project (&ldquo;we&rdquo;) so people can
              try the software. Questions and privacy requests go to {CONTACT}.
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
                one-way hash), and your full name, date of birth, phone number and residential address.
              </li>
              <li>
                <strong className={LABEL}>What you record:</strong> company details, share classes and holdings, wallet
                addresses, the names, addresses and email addresses of people you add or invite, and documents you
                upload.
              </li>
              <li>
                <strong className={LABEL}>When you use the site:</strong> the server&apos;s logs record requests to the
                app and can include network addresses. Network addresses are also used briefly to limit repeated sign-in
                attempts.
              </li>
              <li>
                <strong className={LABEL}>In your browser:</strong> cookies that keep you signed in and protect forms,
                and a few settings such as your theme. There are no analytics, advertising or tracking cookies.
              </li>
            </ul>
          </Section>
          <Section title="How we use it">
            <p>
              Only to run the preview: creating and securing accounts, showing each person the records their role
              allows, keeping each company&apos;s records, and finding and fixing problems. We don&apos;t sell personal
              information, use it for marketing or give it to anyone else for their own use. We don&apos;t collect tax
              file numbers.
            </p>
          </Section>
          <Section title="Where it's kept and who can see it">
            <ul className={LIST}>
              <li>Everything is stored on one server in Sydney, Australia, hosted by Amazon Web Services.</li>
              <li>
                In each company, the people authorised to manage it see its records, and shareholders, employees and
                investors see their own.
              </li>
              <li>We can reach the server and its database to run and fix the preview.</li>
              <li>
                No email leaves the preview. Messages such as sign-up codes are saved on the server, so new
                registrations can&apos;t be completed yet; use a demo account instead.
              </li>
              <li>
                No other service receives your information. Identity checks, company register lookups, payment services,
                push notifications and error tracking are all switched off.
              </li>
            </ul>
          </Section>
          <Section title="How long it's kept">
            <p>
              The preview can be reset at any time, which deletes every account and record, and it keeps no backups.
              Server logs are overwritten once they reach a set size. To have your account removed sooner, email{' '}
              {CONTACT}. Records the app keeps unchanged by design, such as invitations and register entries, may stay
              until the next reset.
            </p>
          </Section>
          <Section title="Your choices">
            <p>
              You can see and correct your profile in the app. To ask what we hold about you, or to have it corrected or
              removed, email {CONTACT}.
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
