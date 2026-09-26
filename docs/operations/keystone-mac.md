# Keystone ownership verification on a Mac

[Operations](README.md) · [Local setup](../getting-started.md) · [Release checklist #624](https://github.com/Ledova/ledova/issues/624)

Use a fresh synthetic local instance to exercise a real Keystone 3 Pro with
Chrome's camera. The owner reported firmware **2.3.6** and no camera on the
Linux deployment computer. The Mac must have a working built-in or connected
camera; owning a Mac alone does not establish camera availability.

This procedure verifies an EIP-191 ownership message. It needs no operator
private key, deployed contract, company approval, funds or gas. Signature
recovery is local; unavailable RPC can leave balances unavailable and wallet
sync queued without preventing ownership verification. Neither is a successful
chain-sync result. This procedure was source-reviewed, not executed on a Mac.

The [Base Sepolia approval-control evidence](approval-controls.md#base-sepolia)
belongs to the existing Linux instance and its two fictional companies. A Git
checkout contains code and documentation, not that instance's database or
credentials. The Mac database created below is separate. Do not copy the Linux
operator key, reset its database or repeat its public deployment for this test.

## Prepare the device

The [official firmware guide](https://keystone3.com/en/docs/firmware-upgrade/)
requires devices below 2.4.0 to install that security upgrade before proceeding
to newer firmware. For the reported 2.3.6, use the upgrade path for versions
**2.0.0 or above**, then follow the official updater for supported **Multi-Coin**
firmware, which supports Ethereum accounts. The
[official download page](https://keyst.one/firmware) listed Multi-Coin 3.1.0 on
25 September 2026; recheck the vendor page when executing this procedure.

The owner performs the update and any on-device approval. Follow the vendor's
battery, backup and [checksum instructions](https://keystone3.com/en/docs/firmware-checksum/).
Keep the recovery phrase offline; it is never entered into Ledova, a browser,
the assistant or GitHub. Record the firmware actually installed. No upgrade
was performed as part of preparing this guide.

## Start a separate local instance

Install/start Docker Desktop with Compose, and have Git and Python 3 available.
Use a clean checkout of the reviewed commit named in the #624 handover. Confirm
the required checks for that application commit passed before starting. Use
Chrome on the Mac; no connection to the Linux computer is required.

From that fresh checkout:

```sh
python3 scripts/init-local-env.py
docker compose -p ledova-keystone-local up --build -d backend dashboard
```

The normal dependencies and backend initialization still run. Wait for the
backend to finish migration/role checks and for both application surfaces to
respond. Check `docker compose -p ledova-keystone-local ps` and the backend logs
if startup fails. Do not weaken database role checks to get past an error.

The fresh templates leave operator credentials, external-provider credentials
and deployed contract addresses unconfigured. Leave those values unconfigured
for this ownership-only exercise. No worker, chain node or deployment command
is needed. Do not reuse an unrelated checkout's existing environment files.

Create the documented synthetic demo once, retaining its generated credentials
in a private local file:

```sh
umask 077
mkdir -p "$HOME/.local/share/ledova-keystone-local"
docker compose -p ledova-keystone-local exec -T backend \
  python manage.py seed_demo \
  > "$HOME/.local/share/ledova-keystone-local/demo-credentials.txt"
```

The owner reads the **investor** login privately. Do not paste credentials or
the file contents into an issue or assistant output. Rerunning `seed_demo`
resets the seeded passwords. The demo's signup, identity, terms, classification
and preverified development wallets are synthetic setup, not human acceptance.

Open <http://localhost:5174> in Chrome, sign in, and open **Wallets**. The API is
<http://localhost:8000>. These are the fresh Mac defaults; the separate Linux
acceptance instance uses different ports. Check the camera permission in
[macOS Privacy & Security](https://support.apple.com/guide/mac-help/mchlf6d108da/mac)
and allow the site's camera request when the scanner opens. `localhost` is a
[camera-capable secure context](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia);
a plain HTTP LAN address does not supply the same browser guarantee.

## Import and prove the hardware account

1. On the unlocked device, select **Connect Software Wallet → MetaMask** to
   display the public-account QR. This is an export mode; a MetaMask extension
   connection is not required by Ledova's direct QR flow.
2. In **Wallets → Base → + Add wallet → Scan QR**, scan that public-account QR.
   At **Review the accounts to import**, explicitly select **Base** as the EVM
   network, deselect unrelated accounts, and compare the address with the
   device. Import only the intended test account. An unavailable balance is
   not an ownership result.
3. Select the newly imported Keystone wallet. It must start unverified. The
   seed's preverified development wallet is not the device under test. Keep
   the imported derivation path and master fingerprint; a manually entered
   address does not establish the hardware import flow.
4. Choose **Verify → Continue**. Scan the displayed **Scan Challenge** QR using
   the Keystone. The owner checks the ownership message and signs on the
   device. The challenge expires after five minutes; generate a fresh one if
   necessary.
5. Choose **I've Signed the Message**, scan the device's response, and retain
   the actual **Wallet Verified!** result. Reload the wallet and confirm it
   remains verified through the normal authenticated application readback.

Public-account import supports multipart `ur:crypto-multi-accounts`. The
signature scanner currently requires one complete `eth-signature` QR with a
65-byte signature. If a device emits an unsupported format or a scanner fails,
retain the error and report it on #624. Do not substitute a database override
or the seeded wallet's verified status. The current flow has no QR-file-upload
alternative to the camera.

## Record the result and continue

Record tester, time with timezone, application commit, macOS/Chrome versions,
Keystone model, firmware before/after, camera result, public-account import,
challenge signing, signature decoding and verified-wallet readback. Keep full
hardware addresses, account metadata, credentials and QR payloads in private
evidence unless the owner chooses to publish them. A public issue comment can
use a masked address and report PASS/BLOCK with the observed error.

Ownership PASS does not complete EIP-712 order signing, transaction signing,
physical Android/iPhone acceptance or the release-deployment swap in #624.
Those need their own actual device evidence. Coordinate any defect with the
existing issues before starting a parallel implementation; Claude owns #732.

To stop this Mac instance while retaining its local data:

```sh
docker compose -p ledova-keystone-local down
```

Do not add `-v` unless intentionally deleting the separate Mac test database.
