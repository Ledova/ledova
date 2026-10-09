# Product and functionality

[Documentation](README.md)

Updated 9 October 2026 · Agreed product direction, paired with the
[regulatory pathway](regulatory-pathway.md)

## Purpose

Ledova is a share registry that companies and their shareholders use to manage
their relationship, company decisions and ownership records. Authorised company
representatives maintain the register and direct issuance and ownership changes;
shareholders manage their particulars, evidence, requests and holdings. The
software records authority, applies approved actions and preserves their history.

The core is a simple private-company register: non-paid employee awards and
vesting records, shares allotted for externally arranged investor capital,
accurate ownership and history, member access and basic outputs. Ledova records
and supports the company's established processes; it does not need to design
employment incentives, funding rounds or payment collection.

The [9 October owner decision](decisions.md#essential-registry-and-development-workflow-priority)
puts development-workflow simplification (#943) first. New integrated AUD
payments, trading, advanced governance and filing workflows are deferred. Useful
existing payment and chain functionality remains guarded and its records are
preserved. Wallets and tokenisation are required only for a selected chain action.
Private self-hosting uses the same registry and authority model.

Crypto on-ramp purchases remain optional personal investor functionality.
Companies must not buy Bitcoin, Ethereum or another cryptocurrency through it.

This page defines what to build; the [regulatory pathway](regulatory-pathway.md)
covers the route to launch. The sections after the product definition describe
the repository's current implementation of it.

## 1. Who uses Ledova

| User                                | What they can do                                                                                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company representatives             | Manage the company's shareholder relationships, share classes, membership records, issuance, required approvals and governance under recorded company authority. Company decision-makers approve issuer decisions; authorised company administrators carry them out. |
| Investors and shareholders          | Discover companies, review opportunities, manage their particulars, evidence, requests and holdings, obtain permitted records and certificates, and make or accept sale offers. The same person may buy and sell.                                                    |
| Infrastructure and support staff    | Operate hosting, security, integrations and background jobs; recover technical failures and provide controlled support. Routine company register work and issuer decisions belong to the company.                                                                    |
| Crypto and payment operations staff | Perform separately authorised crypto, screening and payment operations, including required reviews and reconciliation. These permissions do not grant authority to make issuer decisions or administer a company's member register.                                  |

Companies have isolated private workspaces. Only intentionally published
profiles and listings are discoverable across the platform.

Only investors acting in their personal investing capacity may use the optional
crypto on-ramp. Company authority and ownership of a receiving wallet do not
grant that permission. Company wallet actions needed for authorised share
workflows remain separate from crypto purchases.

Roles may support automated execution: the software can validate and apply a
company-approved instruction without a Ledova staff member operating the register.
Automation must preserve the named company authority and evidence behind each
decision. A technical support or signing role cannot supply that authority.

## 2. Core functionality

| Capability                     | Intended behaviour                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company setup and authority    | Establish share classes, opening ownership and company appointments; retain the existing representative checks, scoped authority and revocation.                                                        |
| Register and cap table         | Maintain member particulars, issued ownership, approved changes, corrections and attributable history; reconcile chain records where relevant.                                                          |
| Employee awards                | Retain the company's award agreement and vesting schedule, distinguish entitlements from issued shares, and record company-confirmed vesting and approved issues without requiring an employee payment. |
| Investor capital and allotment | Record an externally agreed investment and capital evidence, then the exact company-approved allotment. Agreement, receipt and issued ownership remain separate.                                        |
| Member access                  | Let shareholders and employees read permitted own records and request particulars changes through one account-to-member association.                                                                    |
| Basic outputs                  | Supply company-authorised certificates, inspection copies and exports with genuine register provenance and private access.                                                                              |

Current grants issue outright shares. Structured vesting records and new
company-managed off-chain investor allotments are planned, not delivered by
attaching a contract to a grant. No legal/tax rule engine or option-exercise
scheme is selected. #866 owns the single member-account association; its access
policy remains an owner decision.

Company discovery, marketplace, payment and chain features already present in
the experimental product remain subject to their existing controls. Expanding
them is outside this core delivery scope. Companies set their own terms; Ledova
does not guarantee prices, liquidity or investment performance.

## 3. The registry journeys

### Employee awards and vesting records

1. The company records its agreement, recipient, award terms and vesting schedule.
2. The record distinguishes the contractual entitlement from shares actually
   issued under that arrangement.
3. The company confirms relevant vesting events and approves the exact issue
   when an allotment is due; Ledova retains the supporting authority and evidence.
4. The register and employee's permitted view show actual ownership and its
   history alongside the distinct award record.

This is target scope. Current non-paid grants issue their full approved quantity
outright; they do not calculate vesting or promise future issues. An option or
conditional award must not silently become issued shares. The supported
arrangements need explicit scope before implementation.

### Investor capital and newly issued shares

1. The company and investor agree terms through their established investment
   process; a funding-round label alone establishes no payment or ownership.
2. The company records that agreement and genuine external capital evidence,
   including amount, currency, date and reference where provided.
3. The company approves and records the exact recipient, class and share allotment.
4. Ledova updates ownership once and retains the agreement, authority and history.

Money is received outside this registry workflow by the company or its appointed
provider. Recording company-provided evidence does not claim that Ledova
collected funds or independently verified receipt. A commitment or payment alone
does not establish that shares were issued. New off-chain investor allotments
remain a #868 delivery gap.

### Ownership changes and access

Retain imports, grants, supported direct transfers and compensating corrections
as genuine ledger events. Keep the actual dates, actors, instruments and
resulting quantities. Members can obtain their permitted records and outputs
without a wallet where no chain action is involved. Contractual terms, receipt,
company issue authority, technical execution and register entry stay distinct.

### Existing payments and deferred expansion

Current primary subscriptions have staff-attested AUD bank-transfer instructions
using operator payment settings. Current secondary settlement uses a prefunded
stablecoin atomic swap. Preserve their useful controls, evidence and uncertain
execution recovery. These mechanisms do not deliver the planned company-managed
off-chain allotment or a direct AUD secondary market.

New integrated AUD collection, payment automation and secondary market expansion
are deferred under the [9 October decision](decisions.md#essential-registry-and-development-workflow-priority).
#868 now focuses on external capital records and company-approved allotment;
#869 retains later transfer/settlement work. Future payment mechanics require an
owner decision. Recording AUD capital is distinct from AUD pricing, a stablecoin
or a Ledova-operated payment rail. Core registry journeys require no crypto
on-ramp purchase; investor-only optional use retains #920's guards.

## 4. Self-custody and ownership records

Investors control their wallet keys. Ledova does not hold their money or
assets, own shares on their behalf, or act as buyer or seller. Use an
established public blockchain or suitable public Layer 2.

Self-custody allows disclosed restrictions on share transfers. Companies
control their issuer administration and required approvals under defined
rules. Any party able to change eligibility, block transfers, recover holdings
or upgrade contracts must have explicit, limited and auditable authority. Do
not add an unrestricted Ledova key capable of seizing holdings.

The working first-version design keeps the company member register
authoritative and reconciles it with the blockchain representation, subject to
legal confirmation. Detect discrepancies and retain authorised corrections; do
not assume token possession alone establishes membership.

## 5. Verification and transaction controls

Companies or their providers verify identity, wallet control and eligibility.
Reusable evidence does not automatically grant approval across companies. The
[regulatory pathway](regulatory-pathway.md) identifies the relevant sources and
legal questions.

The proposed mechanism uses a screening service to supply verifiable status or
signed approvals to the share contract. Providers, token standards and data
formats remain open.

The required behaviour is:

- Apply checks at relevant stages, including listing, acceptance and transfer
  where required.
- Bind approvals to the correct participant, company, wallet and action;
  enforce expiry, revocation and protection against reuse.
- Enforce rules on direct contract calls and delegated transfers; check
  administrative and recovery paths for bypasses.
- Refresh affected permissions when evidence or restrictions change, with
  documented update delays.
- Hold affected actions when required checks are stale, unavailable or
  unresolved, with review and recovery procedures.
- Resolve mistaken identity matches and expired restrictions through an
  accountable correction process.

Keep private evidence off-chain. Screening providers must be replaceable while
preserving effective restrictions.

## 6. Privacy and portability

Encrypt private records and restrict access. Publish minimal contract data and
proofs; wallets and hashes are not automatically anonymous.

Retain a tamper-evident history linking listings, accepted terms, approvals,
payment evidence and blockchain events. Authorised exports support complaints,
administration and lawful information requests.

Companies can export their register, holdings, share classes, documents,
approvals, history, permitted verification records and contract information.
Include the authority and instructions needed to continue through another
interface or provider while preserving required restrictions.

## 7. Initial delivery scope

After the #943 workflow improvement, deliver the employee, investor and ownership
journeys above with company/member access and basic outputs in web and mobile.
Use fictional companies and synthetic data; no live-operation permission is
implied. The earlier Market choices remain
[historical decisions](decisions.md#the-signed-in-app) for existing functionality,
not a prerequisite to finishing the registry.

Core outputs (#871) and core journey acceptance (#873) do not wait for deferred
trading (#869), advanced governance (#870) or filings (#872). Preserve earlier
journey evidence and historical migrations. Separate genuine human release
acceptance under #624 remains necessary.

The scope excludes Ledova custody, nominee holdings, investment recommendations,
proprietary market making, a Ledova stablecoin and a proprietary blockchain.
No fee model or legal/tax rule engine is selected. The regulatory pathway
continues to determine conditions for live operation.

## 8. Guidance for implementation

Inspect current code and GitHub claims, reuse the existing programme issues and
keep delivered behaviour distinct from planned scope. Respect other agents'
assets and keep one member-account association under #866. Prefer small changes
to the existing register and company authority model over parallel workflows.

[#943](https://github.com/Ledova/ledova/issues/943) owns the immediate CI priority:
measure costly test work, simplify verified duplication/setup and improve
scheduling. Use focused checks during development, applicable green CI on the
stable merging head and wholly nonauthor review. Proposed timing, routing or
verification tiers are not delivered merely by recording this direction.
Preserve meaningful authority, isolation, economic, evidence, retention,
recovery and historical migration coverage.

Then complete [company-managed register essentials](architecture/company-managed-registers.md).
Companies decide issuer actions; bounded jobs execute those instructions without
inventing staff approval. Retain accurate issued totals, private evidence,
append-only history and original uncertain transaction recovery. A non-chain
entry must not need a wallet, fabricated chain receipt or payment integration.
Existing technical signing and payment permissions supply no company authority.

Defer new integrated AUD payments, trading, advanced governance and filings.
Retain their useful existing controls and historical records. Optional investor
crypto purchases remain separate; companies cannot open that integration.
Update the existing decisions and issues before implementing an undecided
vesting arrangement, member access policy or future payment model.

<a id="roles-and-deployment-modes"></a>

## Roles and deployment

The accepted direction is one registry product, used on Ledova-hosted or private
self-hosted infrastructure. Hosting location does not introduce a separate
single-issuer product or make Ledova staff the company's routine register
administrators. A private instance may contain one company or several, using the
same company access boundaries and authority model.

The repository's current terms for the users above:

| Term     | Meaning                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator | Current deployment configuration and staff tooling for Django admin, review queues and the operator signer; target infrastructure and separately scoped crypto/payment operation responsibilities |
| Issuer   | The company offering and issuing shares; “company” names the entity                                                                                                                               |
| Investor | A person investing through their account and verified wallets                                                                                                                                     |
| Account  | The person's customer account, linked to one profile                                                                                                                                              |
| Wallet   | An account's address on a specific network; the same EVM address on two networks is two wallet records                                                                                            |

One operator configuration exists per deployment. The legacy `Registry` and
`Single issuer` setting and its evidence visibility branches are removed by
[`operators/0002`](operations/upgrades.md#one-registry-product). Supporting
payslips and classification evidence retain private access, human review and
retention controls on every instance. This retirement does not grant company
administration capabilities. See [operator setup](operations/operator-console.md)
for existing configuration and
[company-managed registers](architecture/company-managed-registers.md) for the
target responsibility and migration plan.

## Current capability boundaries

This is the repository's experimental implementation of the definition above,
not a claim that it can operate a real market. Keep all identities, companies,
payments and assets synthetic.

The company-managed direction above is accepted product scope, not a description
of capabilities already delivered. Several company and register actions still
require staff tooling today. Their current gates must remain effective until
company authority, permissions and replacement workflows are implemented.

| Capability                           | Current boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company onboarding and share classes | Self-declaration admission and administrator company activation retain the configured identity/ABR checks and evidenced failure/retry outcomes; [company-authorised empty deployment](plans/company-managed-registers/company-deployments.md) runs from the Register in both clients, with exact retained approval and original technical recovery; deployment issues no shares; the [wallet workflow](plans/company-managed-registers/company-wallet-approvals.md) adds explicit one-wallet nomination and company instructions; [non-paid chain grants](plans/company-managed-registers/company-register-issues.md) use exact company instructions and genuine finalised Mint outcomes; [company-authorised capital increases](plans/company-managed-registers/company-capital-increases.md) and [pause/unpause](plans/company-managed-registers/company-pause-changes.md) retain exact decisions and original execution recovery; [company-authorised paid issues](plans/company-managed-registers/company-paid-issues.md) use existing recorded PAID subscriptions on deployed Base classes with exact approval and original execution recovery; new off-chain investor allotment and populated-register mirroring remain later work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Representative authority             | Draft-company owners can submit private requests, accept the exact authorisation/responsibility declaration and obtain an initial scoped appointment after existing configured identity/ABR checks; [withdrawal and self-revocation](plans/company-managed-registers/authority-requests.md) retain evidence/history. Scoped team invitations, acceptance, administrator team reads, retained revocation, web/mobile screens and the legacy-owner upgrade are delivered; the implemented register commands use those appointments; remaining workflows retain their existing gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Tokenized shares                     | Whole-share issuance and authorized caps are enforced on chain, and so is each company's whitelist, with its expiry, for both the sender and the recipient of a transfer; [company wallet instructions](plans/company-managed-registers/company-wallet-approvals.md) consume explicit nomination, genuine possession proof and current exact-company GENERAL eligibility with finite expiry; technical [refresh](architecture/outgoing-signing.md#refreshing-an-approval) only removes under actual retained loss causes; admission, original execution and approval projection remain distinct                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Investor classification              | Claim/evidence submission and review status exist in both clients; staff review is in admin; eligibility scopes discovery and subscriptions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Primary offerings and subscriptions  | Directory, with the documents of approved offerings, Applications and recorded payment instructions are available in both clients; payment confirmation and refunds remain operator actions; existing recorded PAID subscriptions on deployed Base classes can use company-authorised paid issues, with original execution and genuine allotment outcomes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AUD and stablecoin payments          | Current primary AUD bank-transfer and stablecoin receipts and refunds remain operator-attested in admin. Recorded PAID subscriptions can feed company-authorised paid chain issues; their allotment outcome requires a genuine finalised Mint. Historical financial and issue records retain their original attribution. New integrated payment expansion is deferred; #868 now owns external capital records and company-approved allotment. Future payment mechanics remain undecided. Current secondary stablecoin settlement does not deliver direct AUD settlement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Register                             | Current members are read from the stored register once a share class's opening is applied, with the chain unreachable; former members are retained records; a scheduled job reconciles them with the chain, and every export is recorded; register readers read each reconciliation and its acknowledgements through the API, and each class's entries and latest reconciliation through the API or the Register in either client, where a current company approver or administrator acknowledges a discrepancy with a reason; an import adds particulars and pre-platform former members to a class opened from the chain, or opens a class not yet on chain, which supports company-run non-paid grants and direct non-paid transfers without a wallet; the company prepares, approves and applies an import itself through the API or the Register in either client, with its own evidence and stated ASIC figures, and a compensating correction that reverses one entry exactly, with its own authority document, in the same places; it opens a deployed class's register from the chain in the same places, mapping the on-chain holders to members, with the chain boundary captured when it prepares the opening; it also prepares, approves and applies a change to a member's name and residential address in the same places, with a reason and its own supporting document, where the latest "as at" date between imports and changes wins and a member's live verified identity still wins over both; it links wallets to members in the same places, with its own authority document, recording the issues and transfers that waited for a link; non-paid chain grants retain company authority, terms and required acceptance through exact member, nomination and finite wallet approval instructions, with first-member LINK available before a mint; their finalised original Mint supplies the original member's ISSUE once; paid chain issues now retain exact company authority over existing recorded PAID subscriptions, with distinct execution, allotment and register outcomes; imported classes remain unsupported by that chain workflow; settled transfers retain their current staff-reviewed director instructions until their company conversion lands; staff prepare inspection copies, certificates and notice figures on the company's written instruction, and list those still due; the issuer can list the completed effects still waiting to be entered, with the reason each waits; the company owner and anyone holding a current company appointment with administration or a register capability read the register and its export in both clients, and retained register proposals through the API |
| Portfolios and crypto wallets        | Holdings, valuations, history, verified-address flows and supported test-network transfers exist; unpriced shares do not imply a market valuation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Secondary trading                    | Order, matching and settlement are enabled by default on the experimental deployment; releases still require the human checks in [#624](https://github.com/Ledova/ledova/issues/624)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Mobile                               | Holdings, Notices, Activity, Register, Invest and Wallets flows exist in the paper interface; native security needs a Ledova build, with separate device acceptance checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Crypto on-ramp                       | Optional personal investor functionality. The API checks a current investor/dual-role account and owned receiving wallet before contacting the provider; both clients refuse company/unknown entry and retire deferred/open provider views on account or role loss (#920). External-provider and physical-device acceptance remain separate. There is no off-ramp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The [roadmap](roadmap.md) orients the remaining work. A feature flag or configured
provider does not establish safety or regulatory compliance.

## Terms that must stay distinct

- A **share class** is an issuer's equity instrument. A generic **asset** is a
  tracked coin/token; a **settlement asset** is an approved payment token.
- **Authorized shares** are the issuance cap; **issued shares** are actual
  register ownership, including genuine non-chain issues. A selected chain
  representation has a separate minted supply to reconcile. The
  [issuance reference](architecture/contracts-and-issuance.md) explains the
  historical API names.
- **Eligibility** concerns whether an investor qualifies for an offering.
  Each company's on-chain **whitelist** determines which addresses can receive or send its share tokens.
- The **directory** advertises share classes offered to eligible investors.
  The secondary **market** concerns trading existing shares. Neither is a list
  of investors.
- **Payment received**, **allotted**, **broadcast**, **confirmed** and **finalized**
  are separate states. An accepted broadcast is not evidence of mining; receipt
  evidence does not itself establish finality.

Next: the [regulatory pathway](regulatory-pathway.md),
[system architecture](architecture/README.md), [local setup](getting-started.md),
and the [reasons behind product choices](decisions.md).
