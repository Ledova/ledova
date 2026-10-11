# Retired Mac runner lifecycle source

These six files preserve the former two-profile Mac/Lima runner controller for
historical review and separately approved manual reuse. They are retired from
normal CI. No workflow, Make target, installer or login service calls this folder;
main, manual and pull-request checks use GitHub-hosted Ubuntu.

The preserved controller validates reviewed main commits and workflow bytes,
exact job/group/registration identity, one-job ephemeral Linux guests, private
reservations and receipts, guest isolation, busy-job completion, registration
removal and diagnostic retention before deleting an owned clone. Unknown state
keeps inspection evidence instead of claiming disposal. The recorded profile
names and old execution budgets describe the historical controller, not current
CI or a supported automatic startup path.

Machine-specific root paths, repository/group IDs and group labels, the base VM
name and guest account have been replaced with explicit environment inputs:

| Input                                                                  | Required meaning                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `LEDOVA_MANUAL_RUNNER_ROOT`                                            | Canonical private directory containing separately installed lifecycle source and its protected state |
| `LEDOVA_MANUAL_REPOSITORY_ID`                                          | Positive numeric ID for the fixed `Ledova/ledova` repository                                         |
| `LEDOVA_MANUAL_SCOPED_GROUP_ID`, `LEDOVA_MANUAL_SCOPED_GROUP_NAME`     | Explicit owned backend group ID and safe label/name                                                  |
| `LEDOVA_MANUAL_ORDINARY_GROUP_ID`, `LEDOVA_MANUAL_ORDINARY_GROUP_NAME` | Distinct explicit owned checks group ID and safe label/name                                          |
| `LEDOVA_MANUAL_BASE_VM`                                                | Explicit owned stopped base VM name                                                                  |
| `LEDOVA_MANUAL_GUEST_USER`                                             | Existing isolated base guest account for the shell wrapper                                           |

There are no installed-machine defaults. Python source is retained alongside the
shell wrapper and offline registration helper in `evidence/`. Their existing
private policy, authentication, slot receipts, registration state, Lima base and
diagnostics remain outside Git; this folder supplies none of them. The source
still expects the original strict private-file permissions and policy/ownership
contracts. It assumes macOS Homebrew tools and a prepared Linux ARM64 guest.

Do not invoke or import these operational programs merely to inspect them: some
have top-level registration/session actions. Read source or parse its syntax.
Any future reuse needs explicit owner direction, fresh independent source and
configuration review, bounded synthetic verification and newly proven ownership.
This archive installs no service, creates no guest or registration, supplies no
credentials and does not reactivate the retired pool. Preserve the installed
private evidence and drain state; never copy runtime secrets into this folder.
