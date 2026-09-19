# Operating model A: a company-hosted instance

[Legal and regulatory](README.md) · [Registry service](registry-service.md) · [Positions](positions.md) · [Regulatory pathway](../regulatory-pathway.md)

A private company deploys and runs its own Ledova instance, for its own shares
and its own shareholders, with no other company on it. Its own officers make
every entry. Ledova is infrastructure the company uses to keep its register and
the processes around it. The software ships this shape as its single-issuer
deployment mode ([product page](../product.md#roles-and-deployment-modes)).

This page is the project's reading of primary sources and regulator guidance,
not advice; the [positions](positions.md) it rests on are numbered where they
apply, and the drafted ones remain unconfirmed until the owner signs them off.

## Whom the law looks at

The company and its directors, and nobody else. Every duty in
[position 6](positions.md#6-where-and-in-what-form-the-register-is-kept) is
theirs already, whether the register is a spreadsheet, a minute book or an
instance of this software. Running the software creates no new legal person:
there is no separate operator (the company holds the product's operator role
itself), no agent, no service agreement, and no one holding the company's data
on its behalf unless the company chooses a host.

Ledova the project is a software supplier. On the reading in
[position 4a](positions.md#4a-a-registry-service-acting-only-on-instruction-is-not-a-financial-service),
supplying software is not a financial service, and the licence permits a company
to use the software for its own purposes
([position 5](positions.md#5-the-licences-competing-use-test-and-who-we-is)).
If the project also hosts or supports the instance, the reading is that it
becomes an IT supplier to the company: a hosting agreement with a data-processing
clause, and nothing from the financial services perimeter, provided it never
makes a register entry itself.

**The pivot is who makes the entries.** A company whose own officers record
every issue and transfer, on whatever servers, is running this model. The moment
someone outside the company makes entries on its behalf, the
[registry service](registry-service.md) begins, and with it a second legal person.

## What the company can do with no permission

On the readings in positions 4a, 4b, 6, 7, 9 and 11:

- **Keep its register** in the instance as the register of members.
- **Issue its own shares.** A body corporate's transaction relating only to its
  own securities is not dealing (s766C(4)), so issuing needs no licence. The
  offer itself is governed by the fundraising rules the company already lives
  under: a proprietary company may offer shares to existing shareholders and
  employees without a disclosure document (s113(3)), and to wholesale and
  sophisticated investors under the s708 exemptions
  ([position 11](positions.md#11-the-companys-own-fundraising-and-scheme-obligations)).
- **Issue shares to employees** under Division 1A of Part 7.12: the offer states
  that it is made under the Division; where no money is paid, that statement is
  the disclosure; where employees pay, the $30,000 cap applies.
- **Record transfers its directors approve.** A proprietary company's directors
  may refuse to register a transfer for any reason (s1072G); the instance records
  the instrument, the decision and the new holder.
- **Produce certificates and the figures for ASIC's notices** within the limits
  in [position 6](positions.md#6-where-and-in-what-form-the-register-is-kept).
- **Keep a tamper-evident log of its own entries**, on a database or a ledger,
  as long as the database remains the record that can be reproduced, inspected
  and corrected.
- **Take money for its shares into its own bank account**, or stablecoin into
  its own wallet. No one else touches the money, so no client-money or
  virtual-asset rule is engaged.

## Where the perimeter is for a company acting for itself

| Regime | When a company running its own instance crosses it | What it then needs |
| --- | --- | --- |
| Market licensing | Only if it opens a board where its shareholders post offers to buy or sell from each other, so that offers are regularly made through a facility it operates (s767A). | Registration with ASIC as a low-volume market: at most 100 completed transactions and $1.5m a year, proposed $2.5m. ASIC's register of 8 September 2026 lists over two hundred companies, most of them community bank companies, doing exactly this in their own shares; their boards list buyers and sellers and leave the parties to settle between themselves ([position 7](positions.md#7-a-register-is-not-a-financial-market)). |
| Financial services licensing | Not by issuing its own shares, recording transfers or running a notice board. It would cross it by holding shares or tokens for other people as a business, or by arranging deals in other companies' securities, neither of which this model involves ([position 4a](positions.md#4a-a-registry-service-acting-only-on-instruction-is-not-a-financial-service) and [position 11](positions.md#11-the-companys-own-fundraising-and-scheme-obligations)). | Nothing, in this model, on the positions as drafted. |
| Digital assets, from 9 April 2027 | Possibly, if the company holds tokens that represent its own shares "for or on behalf of" its shareholders in wallets it controls. Whether an issuer's internal ledger of its own shares is a digital asset platform has not been verified ([position 9](positions.md#9-digital-assets-and-custody)). | Keep the ledger internal, so that no holder possesses a token through the company, or let holders keep their own keys. |
| AML/CTF | A company is not a reporting entity for issuing its own shares or keeping its own register, and does not become one by accepting payment into its own account or wallet ([position 8](positions.md#8-amlctf-obligations-of-the-operator)). | Nothing, in this model. Its accountant or lawyer may have duties of their own when they assist a transaction. |
| Privacy | The company holds its shareholders' names and addresses, as it always has; its obligations follow its own status under the Privacy Act ([position 10](positions.md#10-privacy)). | Build to the Australian Privacy Principles regardless. |

## Feature by feature

| Feature | Status in this model |
| --- | --- |
| Register of members, certificates, figures for notices | No permission |
| The company issues its own shares, including to employees | No permission, under the company's own fundraising rules |
| Recording transfers the directors approve | No permission |
| Taking money for shares in dollars or stablecoin | No permission, into the company's own account or wallet |
| Finding investors and making the company's own offer | No permission, within the fundraising rules the company already has |
| A board where holders post offers, settled between the parties | Register with ASIC as a low-volume market |
| Matching or settling trades on the instance | Licence: market and possibly settlement; not realistic for one company |
| Holding tokens or keys for holders | Avoid: unverified under the 2027 regime |
| The ledger as the register of record, replacing paper transfers and certificates | Relief: an approval of the ledger as the register's form and a declaration on transfer mechanics; nothing a company needs while the database remains the record |

## Getting a first company there

A private company that wants to issue shares to an employee can run this model
now, on the positions as drafted. The sequence is short because almost all of it
is the company doing what it must do anyway.

1. **Choose where the instance runs.** The company's own cloud account, or a
   managed host. Hosting can be outsourced; the entries cannot, or the model
   changes. If the record sits away from the registered office, the company
   lodges the notice of where the computer record is kept (s1301, Form 991).
2. **Load the existing register**, including anyone who ceased to be a member in
   the last seven years, and reconcile it against the share structure ASIC
    holds. Fix any discrepancy with ASIC before relying on the instance. This is
    the import listed as remaining work in the
    [stored-register issue](https://github.com/Ledova/ledova/issues/647).
3. **Name who may make entries and who approves.** An officer instructs, a
   director approves, and the record shows both. Where the administrator is also
   a recipient of shares, someone else approves that entry.
4. **Record the first issue.** The board resolution and the scheme offer and
   acceptance sit beside the entry; the certificate follows within two months
   and the notice figures within 28 days.
5. **Run it.** Transfers on a proper instrument with the directors' decision;
   inspection requests answered from the export; the annual review confirmed
   from the register.
6. **Optionally, open a transfer board** for shareholders, registering it with
   ASIC as a low-volume market first.

| Cost | In this model |
| --- | --- |
| Licence and enrolment fees | None, on the positions as drafted: no AFSL, no market licence, no AUSTRAC enrolment for a company acting for itself |
| Recurring | Hosting, backups and someone to administer the instance; the accountant who already lodges the company's notices |
| Optional filings | The computer-storage notice; a low-volume market registration if a transfer board is opened |

## What to avoid

- **Letting anyone outside the company make entries.** That is the other model,
  with its own legal person and agreement.
- **Holding tokens or keys for shareholders.** An internal ledger or self-custody
  keeps the 2027 question from arising.
- **Treating the ledger as the register.** A court can order the register
  corrected (s175) and anyone may inspect it (s173); the database must remain the
  record that can be corrected and reproduced, with the ledger as a mirror unless
  ASIC approves otherwise under s1306(1)(c).
- **Opening a transfer board before registering it.** Registration is a form;
  operating an unregistered market is an offence.
- **Exceeding the proprietary company limits** of fifty non-employee
  shareholders, or offering shares to the public. Those are Parliament's lines.

## How this differs from the registry service

In the [registry service](registry-service.md) a provider hosts one platform and
makes entries for many companies on their written instructions. That provider is
a new legal person: it needs an operating entity, an agreement with each company,
a privacy posture, and constant discipline about a boundary this model does not
have, because a business assembled from exempt clerical tasks can still be
judged an arranging business in aggregate (RG 36.53). The trade is that
companies get a service instead of a system to run, and the project gets a
business. This model is the simplest legal position available and is where a
first company can be tomorrow; the registry service is where a company that
keeps registers for others is built.

## Open questions

1. Whether a company holding tokens that represent its own shares, for its own
   shareholders, is a digital asset platform under the 2027 regime.
2. Whether an instrument of transfer signed inside the software is a "proper
   instrument of transfer" under s1071B; the regulations that set the required
   details have not been read.
3. The terms of the low-volume exemption after it sunsets on 1 October 2026 and
   is remade, as CS 60 proposes; they matter only if a transfer board is opened.
4. Whether a managed single-company instance, hosted by the project but operated
   by the company's officers, is offered as the first paid product. Its legal
   profile is this model's; its commercial profile is the service's.

Next: the [registry service](registry-service.md), then the
[positions](positions.md) each model rests on.
