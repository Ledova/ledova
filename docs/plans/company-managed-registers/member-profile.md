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

## Member register access

The [member-access journey](member-access.md) implements company-issued,
member-specific invitations accepted by the signed-in intended recipient.
Associated members read their own company-recorded particulars, holdings,
history and awards, and submit requests for company review. This Profile form
remains separate: saving it changes no register record or company mandate.
Certificate requests are retained; actual fulfilment follows #871.
