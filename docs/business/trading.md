# Wallets, transfers and trading

[Business processes](README.md) · [Documentation](../README.md)

How the API keeps investors' own wallets and their sends, how the experimental secondary market's
API trades existing shares, and how both sit beside the company's register. The order, matching,
settlement and transfer mechanisms are in
[trading protocols](../engineering/trading-protocols.md#intent-and-settlement) and
[wallet transfers](../engineering/wallet-protocols.md#transfer-lifecycle). Neither has a page in the
web app ([wallets](#wallets-and-wallet-sends), [trading](#what-trading-is-today)), and the mobile app
is for shareholders ([decision](../decisions.md#mobile-app-for-shareholders)).

Contents:

- [What trading is today](#what-trading-is-today)
- [Company decisions alongside trading](#company-decisions-alongside-trading)
- [Who may trade and who sees orders](#who-may-trade-and-who-sees-orders)
- [Matching and settlement](#matching-and-settlement)
- [One match, never crossed](#one-match-never-crossed)
- [Accepted experimental limits](#accepted-experimental-limits)
- [Wallets and wallet sends](#wallets-and-wallet-sends)

## What trading is today

The web app has no page for trading: the owner removed Market on 29 October 2026
([decision](../decisions.md#ownership-dashboard-and-compact-sidebar),
[#1416](https://github.com/Ledova/ledova/issues/1416)) after secondary share sales were closed as
not planned. The rest of this page describes the trading API, which keeps its orders, history and
guards.

Trading (orders, matching and settlement) is on by default on the experimental deployment. Platform
staff can switch it off for a deployment, as an operations switch, not a product mode. While it is
off, Ledova refuses every order, trading-wallet, settlement and live-update request, and the
read-only market and each wallet's approval status stay available. Being switched on does not
establish that trading is safe: a release still needs the human checks in
[#624](https://github.com/Ledova/ledova/issues/624), and operation with real participants follows
the [regulatory pathway](../regulatory-pathway.md). New trading and settlement work was deferred
by the [9 October priority](../decisions.md#essential-registry-and-development-workflow-priority) and
is not planned ([#869](https://github.com/Ledova/ledova/issues/869)).

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

- The event stream can miss updates, and recovering stored state does not guarantee an update was
  delivered.
- Two crossing orders placed at the same moment can both rest until the next minute's sweep.
- Changing an order does not run matching: a change that would cross is held back and takes its
  match from the minute's sweep.

The separate
[owner direction on bounded cross-account matching](https://github.com/Ledova/ledova/issues/646#issuecomment-5745448042)
keeps orders private.

## Wallets and wallet sends

The web app has no wallet pages. On 31 October 2026 the owner removed Wallets, Wallet shares,
Activity, Send and Buy crypto, with wallet nominations and company wallet approvals, until wallets
are developed ([decision](../decisions.md#wallets-removed-from-the-web-app), [#1452](https://github.com/Ledova/ledova/issues/1452)). The API keeps wallets, sends and their records, as below.

A wallet is an account's address on one network. Proving control of it (verification) is the
participant's fact; the company's approval of it for its shares is a separate company decision. A
member recorded on an imported register needs no wallet.

Through the API a person prepares sends of native and other crypto assets and payment tokens on the
supported test networks and signs them with their own key. Ledova records what the signed transaction
says, not what the sender typed, and a broadcast but unconfirmed send is not evidence that it was
mined. Base transfers pay fees in ETH.

Shares are never sent as a wallet send: Ledova refuses a share class as a send, including while the
class is paused. A share moves only through a company-recorded
[register transfer](register.md#non-paid-transfers-between-members), an issue, or a settled trade
that the company then enters on its register.

Buying crypto through the provider is optional and only for investors acting in their personal
capacity. Companies must
not buy cryptocurrency through it, and a company appointment or a company's wallet gives no
permission to use it ([decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments),
[#920](https://github.com/Ledova/ledova/issues/920)). Ledova checks for a current investor account
and an owned receiving wallet before it contacts the provider. There is no way to sell crypto for
money through Ledova.

Next: [the register of members](register.md),
[investors and eligibility](participants.md) and
[trading protocols](../engineering/trading-protocols.md#intent-and-settlement).
