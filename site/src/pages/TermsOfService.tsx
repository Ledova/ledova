import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { INLINE_LINK, PAGE_SECTION } from '../styles';

const TERMS = [
  [
    'The service',
    'Blueberry Money Pty Ltd (ACN 691 391 214) provides Ledova, software that Australian private companies use to record and mirror their share ownership and related records. Ledova is technology infrastructure: we host the software and keep it running, and each company directs its own records and changes. We do not review, approve, verify or supervise companies, their representatives, members or records, and we do not act for a company, its shareholders or investors. We do not collect investment money, arrange or execute trades, hold assets or provide legal, financial, investment or tax advice. While the service is marked as a preview, use fictional records and disposable credentials only.',
  ],
  [
    'Your account and authority',
    'Use your own account and keep its credentials secure. When you set up or administer a company workspace, you confirm that you are authorised to act for the company, manage its users and accept these terms on its behalf. We do not check that authority, and accepting these terms does not create it. Give access only to people entitled to the permissions you assign; the company is responsible for what its users do in its workspace.',
  ],
  [
    'What the company is responsible for',
    'The company is responsible for the accuracy, completeness and lawfulness of everything it records, and for keeping its register of members and other records as the law requires, whether or not it uses Ledova to do so; using Ledova does not make us its agent or register keeper. The company is responsible for its decisions and approvals and the authority behind every change it records; for complying with the laws that apply to it, including corporations, fundraising and disclosure, employee share scheme, tax, anti-money laundering and privacy laws, and for its notices and filings with ASIC and other regulators; for deciding who may acquire or hold its shares or awards, including any investor eligibility or transfer restriction; and for any identity, eligibility or background checks it needs on its officers, members, investors or employees. Ledova’s features, including any identity check the service offers, help a company keep records; they do not carry out these responsibilities for it. Recording something in Ledova does not verify or approve it or establish legal ownership. Registration does not incorporate a company, appoint a director or issue shares, and an award is an entitlement, not issued shares.',
  ],
  [
    'Documents and privacy',
    'You keep your rights in the information and documents you provide. You authorise us and our service providers to store, process and deliver them only to provide, secure and support Ledova and meet applicable legal requirements. The company must be entitled to record the personal information it enters about other people and must tell them how it is used. We handle personal information as our Privacy policy describes and remain responsible for our own obligations under privacy law. We restrict access by role and do not sell personal information or use your documents for advertising or AI training.',
  ],
  [
    'Availability and support',
    'Keep the company’s own legal records and copies of important documents. We take reasonable care in providing Ledova, but we do not promise uninterrupted access, that the software suits a particular company or that it meets every legal requirement that applies to a company. Contact hello@ledova.io about faults, access or privacy. We access private records only as needed for authorised support, security or a lawful requirement.',
  ],
  [
    'Liability',
    'To the extent the law allows, Ledova is provided as is, and we are not liable for loss arising from the records, decisions or instructions a company or its users enter, from a company not meeting its own obligations, or for indirect or consequential loss. Where a guarantee that cannot be excluded applies but our liability for breaching it may be limited, our liability is limited to supplying the service again or paying the cost of having it supplied again. The company indemnifies Blueberry Money against claims by others arising from the records, decisions or instructions entered in its workspace, or from its breach of the law or these terms, except to the extent we caused the loss.',
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
    'Material changes to these terms will have a new version and require explicit acceptance. Earlier versions remain available. Nothing in these terms excludes or limits a right, guarantee or remedy that Australian law does not allow to be excluded or limited, or an obligation the law places on us that cannot be transferred by agreement. These terms are governed by Australian law; they do not limit where you may exercise a mandatory legal right.',
  ],
] as const;

export function TermsOfService() {
  return (
    <>
      <PageHeader title="Terms of Service" lead="Version 2026-11-15" />
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
            and the earlier Terms,{' '}
            <Link to="/terms-of-service/2026-11-09" className={INLINE_LINK}>
              version 2026-11-09
            </Link>{' '}
            and the{' '}
            <Link to="/terms-of-service/2026-10-14" className={INLINE_LINK}>
              experimental version 2026-10-14
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
