# Wallets, transfers and trading

[Business processes](README.md) · [Documentation](../README.md)

How investors hold assets in their own wallets, send them, and buy and sell existing shares on the
experimental secondary market, and how those activities sit beside the company's register. The
order, matching, settlement and transfer mechanisms are in
[trading protocols](../engineering/trading-protocols.md#intent-and-settlement) and
[wallet transfers](../engineering/wallet-protocols.md#transfer-lifecycle).

Contents:

- [What trading is today](#what-trading-is-today)
- [Company decisions alongside trading](#company-decisions-alongside-trading)
- [Who may trade and who sees orders](#who-may-trade-and-who-sees-orders)
- [Matching and settlement](#matching-and-settlement)
- [One match, never crossed](#one-match-never-crossed)
- [Accepted experimental limits](#accepted-experimental-limits)
- [Wallets and wallet sends](#wallets-and-wallet-sends)
- [The Market page](#the-market-page)
- [The Wallets page](#the-wallets-page)
- [The Activity page](#the-activity-page)

## What trading is today

Trading (orders, matching and settlement) is on by default on the experimental deployment. Platform
staff can switch it off for a deployment, as an operations switch, not a product mode. While it is
off, Ledova refuses every order, trading-wallet, settlement and live-update request, and the
read-only market and each wallet's approval status stay available. Being switched on does not
establish that trading is safe: a release still needs the human checks in
[#624](https://github.com/Ledova/ledova/issues/624), and operation with real participants follows
the [regulatory pathway](../regulatory-pathway.md). New trading and settlement work is deferred
under [#869](https://github.com/Ledova/ledova/issues/869) by the
[9 October priority](../decisions.md#essential-registry-and-development-workflow-priority).

Ledova is never buyer or seller, and investors control their own wallet keys
([product §4](../product.md#4-self-custody-and-ownership-records);
[what Ledova does](README.md#what-ledova-does-and-what-stays-with-the-company)).

## Company decisions alongside trading

Trades settle in a configured stablecoin. An AUD price or an AUDY balance is not a direct AUD
payment method, and no AUD settlement exists ([decision](../decisions.md#payments-and-settlement)).

The company's eligibility decisions and wallet approvals feed the checks every trade passes
([who may trade](#who-may-trade-and-who-sees-orders)), but a company appointment gives no access to
investors' private orders and no authority to sign for their wallets.

A settled trade moves the share tokens, but reaches the company's register only once its directors
approve it through a register instruction that the company owner submits and platform staff review
([settled-transfer instructions](register.md#settled-transfer-instructions)). Until then the
transfer waits, and so do later issues and transfers of that class. Company-run decisions on
settled transfers are deferred under #869.

## Who may trade and who sees orders

Creating or changing an order and signing a settlement require the acting person to hold a current
[eligibility decision](participants.md#company-eligibility-decisions) from the share class's
company, a wallet the company has
[approved](participants.md#wallet-nominations-and-company-wallet-approvals) and the balance to cover
the order. Either party may pass on the other's signature, so the check follows the signature: the
account that signed must hold the decision. A party whose decision lapses or is revoked between the
two keeps their signature but cannot add another, and the share token itself refuses the settlement.
A buyer must already hold the settlement stablecoin when the buy order is created, so Ledova never
accepts an unfunded offer.

An order is private: only its owner sees and changes it. Platform staff see every order and
settlement read-only in admin ([the market pages](../operations/operator-console.md#the-market)).
Investors who hold a current general eligibility decision from a class's company see that class's
market ([what a decision opens](participants.md#what-a-decision-opens)) as aggregated prices and
remaining quantities, from orders that passed the same checks a match needs. A quote is a snapshot, not a reservation or a promise of a
match. An owner's orders stay listed for them when the share class is no longer listed or
visible, under the class identity recorded when the order was placed; this makes no hidden class
public and authorises no new trade. Unmatched orders never leave in a
[company pack](member-records.md#what-never-leaves-and-why).

## Matching and settlement

Orders match automatically, across accounts, by price and then time. Each deliberate new order,
cancellation and change has its own identity, so retrying one never repeats it, and an unanswered
request is recovered rather than assumed to have failed. A match captures the exact terms and both
participants; both then approve and sign the settlement within its signing window (15 minutes by
default). The settlement is atomic: either the shares and the payment both move, or neither does.
Prefunding does not remove every failure: the buyer's funds stay in their own wallet until the swap
executes, so a swap can still fail if they move first. Once a swap completes, both parties'
holdings are read from the chain.

Order states are **Open**, **Partially Filled**, **Held Back**, **Matched**, **Pending Signature**,
**Completed** and **Cancelled**; an order held back after part of it traded reads **Partially
Filled, Remainder Held Back**.

## One match, never crossed

An order takes one match at a time: once when it is placed, and once more each time its current
match settles with shares left over. While a match is pending, the whole order, its remainder
included, is out of the book, and its owner cannot cancel or change it until the match settles with
shares left, lapses or reverts. An order rests in the book only at a price that does not cross the
other side's listed orders: a bid below the best ask, or an ask above the best bid. Otherwise it is
held back: it is not listed and no other order matches it, but it still counts against the wallet's
balance and its owner can change or cancel it. The rule applies wherever an order would rest: when
it is placed and nothing it crosses can take it (its own wallet's order, or a minimum fill it cannot
meet), when its match settles with shares left, when its match lapses or reverts, and when it is
changed. A lapsed or reverted match returns its two orders oldest first, so the order that was
resting usually rests again and the one that took it is held back.

Every minute, each held order, oldest first, takes its next single match by the same price and time
priority as a new order, or is listed once it no longer crosses. Two orders whose match already
lapsed or failed are never paired again, because the party who did not sign could otherwise keep
locking the other's order. A held order that crosses only such orders, or only orders it cannot
trade with, stays held until they leave the book or its owner changes it. The same minute's sweep
also holds back the newer of any two listed orders that cross
([decision](../decisions.md#payments-and-settlement)).

## Accepted experimental limits

The owner accepted these limits for the experimental version
([#646](https://github.com/Ledova/ledova/issues/646#issuecomment-5745382310)); they are not
scheduled work:

- Live updates can be missed until the page is refreshed; recovering the stored state does not
  guarantee an update was delivered.
- Two crossing orders placed at the same moment can both rest until the next minute's sweep.
- Changing an order does not run matching: a change that would cross is held back and takes its
  match from the minute's sweep.

The separate
[owner direction on bounded cross-account matching](https://github.com/Ledova/ledova/issues/646#issuecomment-5745448042)
keeps orders private.

## Wallets and wallet sends

A wallet is an account's address on one network. Proving control of it (verification) is the
participant's fact; the company's approval of it for its shares is a separate company decision. A
member recorded on an imported register needs no wallet.

From **Wallets** a person sends native and other crypto assets and payment tokens on the supported
test networks. Wallets on Ethereum and Base sign on the device or through a hardware wallet's QR
exchange; Bitcoin sends are signed with external tooling. Ledova records what the signed transaction
says, not what the sender typed, and a broadcast but unconfirmed send is not evidence that it was
mined. Base transfers pay fees in ETH.

Shares are never sent from Wallets: Ledova refuses a share class as a send, including while the
class is paused. A share moves only through a company-recorded
[register transfer](register.md#non-paid-transfers-between-members), an issue, or a settled trade
that the company then enters on its register.

**Buy crypto** is optional and only for investors acting in their personal capacity. Companies must
not buy cryptocurrency through it, and a company appointment or a company's wallet gives no
permission to use it ([decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments),
[#920](https://github.com/Ledova/ledova/issues/920)). Ledova checks for a current investor account
and an owned receiving wallet before it contacts the provider. There is no way to sell crypto for
money through Ledova.

## The Market page

**Market** (for investing accounts, under **More** while trading is enabled) shows each share
class's **For sale** and **Wanted** lists, places buy and sell orders, and lists **Your orders**.
Selling needs the wallet's share and settlement balances from the chain; if they cannot be read,
selling is unavailable rather than showing nothing held.

**Trades awaiting signatures** lists matches the person must review and sign. Orders, cancellations,
changes, signatures and approvals the person started are kept on the device for the signed-in
account and shown below it under **Saved work** while anything is saved; one refresh rereads them.
Work saved in another browser tab appears when Market is reopened on the web or pulled to refresh on
mobile.

## The Wallets page

**Wallets** lists the person's wallets on one card per network, each with its verification and
signing preference, when it last synced, its native balance to at most eight decimal places and its
value in AUD (**Value** on web, **Estimated value** on mobile). On the web each wallet has **Edit**,
**Sync** and **Delete**, with **Verify** and **Derive address** where they apply, and **Add wallet**
is a page action. On mobile each wallet opens its own screen with **Verify address**, **Sync
balances**, **Derive address** and **Delete wallet**, and the page adds **Sync balances** for every
wallet. Adding, editing, deriving and deleting keep what was entered and stay open until they
succeed, and on mobile one in progress cannot be sent twice; an import of several addresses
remembers the ones already added if it is retried. A failed sync is reported in that wallet's row.

**Send** opens its form directly, offering Cancel rather than Back, when the person has exactly one
verified wallet on its networks (Ethereum, Bitcoin and Base), and otherwise asks which wallet; on
mobile a lone Bitcoin wallet opens the Bitcoin send form. It offers crypto and payment tokens,
including AUDY, never shares. **Buy crypto** goes straight to the provider when exactly one verified
wallet is on the chosen asset's network. Each wallet chooser lists only the networks Wallets lists.
When the purchase page cannot be opened, the page gives the server's reason or "The purchase page
could not be opened. Try again." **Wallet shares** opens
[the Wallet shares page](member-records.md#the-wallet-shares-page).

## The Activity page

**Activity** lists recorded wallet transfers, read-only, with exact amounts, network fees and
status. A share transfer's amount carries its class's own symbol. Filters cover whole local days (on
mobile by block time, leaving out records without one), and each entry opens in place to its detail
and a block-explorer link. Dividends are not transfers and do not appear here; they are on
[Notices](publications.md#the-notices-page).

Next: [the register of members](register.md),
[investors and eligibility](participants.md) and
[trading protocols](../engineering/trading-protocols.md#intent-and-settlement).
