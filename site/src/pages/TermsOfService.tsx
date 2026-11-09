import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { INLINE_LINK, PAGE_SECTION } from '../styles';

const TERMS = [
  [
    'The service',
    'Blueberry Money Pty Ltd (ACN 691 391 214) provides Ledova, a free recordkeeping and ownership mirror for Australian private companies. We store company-supplied information and authorised instructions. We do not collect investment money, arrange trading or execute blockchain transactions. Ledova provides no legal, investment or tax advice. While the service is marked as a preview, use fictional records and disposable credentials only.',
  ],
  [
    'Your account and authority',
    'Use your own account and protect its credentials. When setting up a company workspace, you confirm that you already have authority to administer it, manage its users and accept these terms for the company. Acceptance does not create that authority. Give access only to people entitled to the permissions you assign. Members may access only the records the company and their permissions allow.',
  ],
  [
    'Company records and decisions',
    'The company is responsible for accurate information, its legal register, historical records, lawful access arrangements, corporate decisions and filings. Ledova mirrors the records it supplies; storing information here does not verify it or establish legal ownership. Registration does not incorporate a company, appoint a director or issue shares. Each supported change requires its applicable company authority, approval and evidence. An award is an entitlement, not issued shares.',
  ],
  [
    'Documents and privacy',
    'You keep your rights in the information and documents you provide. You authorise us and our service providers to store, process and deliver them only to provide, secure and support Ledova and meet applicable legal requirements. Supply only information you are entitled to provide and tell affected people how their company records are used. We restrict access by role and do not sell personal information or use your documents for advertising or AI training.',
  ],
  [
    'Availability and support',
    'Keep the company’s own legal records and copies of important documents. We take reasonable care in providing Ledova, but do not promise uninterrupted access or that the software meets every company’s legal requirements. Contact hello@ledova.io about faults, access or privacy. We access private records only as needed for authorised support, security or a lawful requirement.',
  ],
  [
    'Leaving Ledova',
    'You can download your account summary and delete your sign-in from Settings. Authorised company users can download the available ledger exports and company pack. Deleting a sign-in does not delete the company’s separate records. An authorised company representative can contact hello@ledova.io to arrange export and closure, identify records still needed for a lawful purpose and agree disposal of the rest. Our Privacy policy explains the periods and limits; we do not promise that every copy is erased immediately.',
  ],
  [
    'Misuse and suspension',
    'Do not access another person’s private records without permission, upload unlawful or malicious material, or misuse the service. We may restrict access when reasonably necessary to protect people, records or the service, or comply with law. We will explain the reason and provide notice and an opportunity to export where reasonably practical; urgent security or legal restrictions may prevent this.',
  ],
  [
    'Changes and your rights',
    'Material changes to these terms will have a new version and require explicit acceptance. Earlier versions remain available. Nothing here excludes rights, guarantees or remedies that Australian law does not allow to be excluded. These terms are governed by Australian law; they do not limit where you may exercise a mandatory legal right.',
  ],
] as const;

export function TermsOfService() {
  return (
    <>
      <PageHeader title="Terms of Service" lead="Version 2026-11-09" />
      <section className="border-t border-border-subtle">
        <div className={`${PAGE_SECTION} space-y-8 text-base leading-relaxed text-text-muted`}>
          <p>
            These terms apply when you explicitly accept them for your Ledova account and, where authorised, your
            company.
          </p>
          {TERMS.map(([title, text]) => (
            <div key={title}>
              <h2 className="font-display text-2xl text-text-primary">{title}</h2>
              <p className="mt-2">{text}</p>
            </div>
          ))}
          <p>
            Read our{' '}
            <Link to="/privacy-policy" className={INLINE_LINK}>
              Privacy policy
            </Link>{' '}
            and the{' '}
            <Link to="/terms-of-service/2026-10-14" className={INLINE_LINK}>
              previous experimental Terms
            </Link>
            . The{' '}
            <a href="https://github.com/Ledova/ledova/blob/main/LICENSE" className={INLINE_LINK}>
              software licence
            </a>{' '}
            governs source-code use separately; these terms grant no additional rights to operate or distribute the
            code.
          </p>
        </div>
      </section>
    </>
  );
}
