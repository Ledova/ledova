# Own Profile personal details

[Implementation index](README.md) · [Member workflows #866](https://github.com/Ledova/ledova/issues/866)

Delivered by [PR #953](https://github.com/Ledova/ledova/pull/953).

## Web and mobile

Profile in both clients shows the signed-in person's full name, residential
address and phone details. Choose **Edit personal details**, change those fields,
and save the form. Saving uses the existing own-profile API and refreshes the
person's displayed details.

The form requires a successfully loaded current Profile. A failed refresh blocks
saving until the current source is available. Changing the signed-in person,
account or native session retires the previous source and prevents its delayed
read or save from filling the new session's Profile. Duplicate submissions are
blocked while the original save is pending.

These are self-reported Profile changes. Existing identity-provider results and
signup requirements keep their current rules. A Profile save creates no company
appointment, member association, register instruction or historical particular
change. The company's evidenced particular-change workflow remains separate.
Backend policy and generated contracts are unchanged by this increment.

## Remaining member work

Account/member association, permitted own register records, company-reviewed
particulars requests and certificate request status are the remaining #866
increments; the invitation/binding policy is an owner decision. This Profile
form supplies their existing personal-detail editor; it does not complete those
workflows or #866.
