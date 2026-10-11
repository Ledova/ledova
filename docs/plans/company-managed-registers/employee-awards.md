# Employee awards and recorded vesting

[Implementation index](README.md) · [Non-paid grants](register-grants.md) · [Owner decision](https://github.com/Ledova/ledova/issues/867#issuecomment-6088911142)

Delivered by [PR #973](https://github.com/Ledova/ledova/pull/973) under
[#867](https://github.com/Ledova/ledova/issues/867).

An employee award records a promised entitlement. The company records the
agreement, recipient, share class, whole quantity and vesting schedule, then
records each vesting event with its quantity, date and evidence. The schedule is
retained text; the software does not calculate vesting from it. Passing a date
does not create a vesting event, approval, share issue or holding.

The first supported issue uses the existing non-paid grant on an opened,
imported register for a draft class without a deployed contract. An award-linked
grant requires the company's separate approval and application. Existing chain
grants and their execution recovery remain separate; recording an award does
not deliver tokenised award fulfilment, an employee purchase or option exercise.

## Company journey

In the Register, the class's Employee awards section distinguishes these
quantities:

| Quantity                  | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| Promised                  | The whole quantity retained in the award agreement            |
| Company-recorded vested   | The sum of retained vesting events                            |
| Issued through grants     | Shares actually issued by applied grants linked to this award |
| Vested and not yet issued | Recorded vested quantity less those actual issues             |

A current company administrator or register preparer records an award with a
new or existing walletless recipient, agreement date and terms, recorded
schedule and supporting agreement document. Recording a promise creates no
register member, entry, position, issued supply or certificate entitlement. A
new recipient retains the same stable identifier that their first genuine
grant will use.

The company records each vesting event separately with supporting evidence.
Agreement and event dates are company-recorded facts no later than today in UTC;
an event cannot predate its agreement. Total recorded vesting cannot exceed
the promise. To issue vested shares,
choose the award in the existing grant workflow. Its class, recipient and
agreement remain bound to the award; upload the matching agreement through the
preparer's existing evidence path. Retain the grant's authority document,
approving director and any required acceptance. After the first genuine issue,
later proposals use the recipient's existing member record and current
particulars, including a retained former-member record.

Preview, approve and apply the grant through the existing decision flow.
Approval alone does not create holdings. Application rechecks company authority,
source evidence, available vested quantity, member particulars, register
sequence and authorised headroom, then records the genuine ISSUE and its
holding once. Pending or approved grants reserve neither vested quantity nor
supply. A transfer or correction does not automatically recycle the original
award allocation. A changed preview needs a new confirmation.

## Authority, privacy and history

New award and vesting rows and files require a current personal appointment for
the exact company with administration, register-read, prepare, approve or apply
capability. Recording facts requires
administration or preparation authority; issuing shares retains the existing
separate grant approval/application capabilities and director-conflict rule.

Award-linked grant reads and files use that same appointment boundary. Earlier
unlinked grants retain their existing read behaviour, history and digests.
Agreement and event evidence remain private, fingerprinted and retained;
changing the retained bytes cannot approve a fresh effect.

Awards and vesting events are append-only company-provided facts with their
original actor, appointment, operation identifier and creation time. Concurrent
events or linked grant applications serialize allocation checks. Failed effects
roll back atomically. Keep an interrupted submission's original request and
operation identifier; confirm the retained outcome before starting another.

This increment adds no employee account association or own-record access rule.
Those remain #866 work. It adds no automatic issued-share restrictions,
forfeiture, exercise price, purchase, payment receipt or tax calculation.

## API

`/api/v1/tokens/register-awards/` and
`/api/v1/tokens/register-award-vestings/` provide bounded list, create and detail
routes. Each detail's `file/` route returns its retained private document.
The existing `/api/v1/tokens/register-grants/` accepts an optional award
reference; it remains the sole issue proposal and decision path for this
supported register boundary.

Migration `tokens/0003_employee_awards` belongs to the
[fresh history](../../decisions.md#minimum-tests-and-fresh-migrations); PR #973
carries the verification under the
[minimum-test policy](../../development/testing.md).
