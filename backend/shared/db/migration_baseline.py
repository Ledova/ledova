from django.core.management.base import CommandError
from django.db.migrations.recorder import MigrationRecorder

from .migration_baseline_cut import (
    ALIASES,
    BASELINE_PHASES,
    PROJECT_MIGRATIONS,
    VENDOR_MIGRATIONS,
)


def _refuse(reason):
    raise CommandError(
        f"Migration baseline admission refused: {reason}. "
        "Upgrade with the last pre-baseline release before adopting this baseline; "
        "do not fake or repair migration records to bypass the refusal."
    )


def require_baseline_history(connection):
    applied = set(MigrationRecorder(connection).applied_migrations())
    for alias, original in ALIASES.items():
        if alias in applied and original not in applied:
            _refuse(f"{alias[0]}.{alias[1]} has no original prerequisite")

    originals = applied & PROJECT_MIGRATIONS
    phases = applied & BASELINE_PHASES.keys()
    if originals == PROJECT_MIGRATIONS:
        missing = VENDOR_MIGRATIONS - applied
        if missing:
            _refuse(f"the old project cut lacks {len(missing)} required vendor migration records")
        return

    if not originals and not phases:
        return
    if not phases:
        _refuse(f"only {len(originals)} of {len(PROJECT_MIGRATIONS)} old project migrations are recorded")

    completed = set()
    for phase in sorted(phases):
        targets = BASELINE_PHASES[phase]["replaces"]
        missing = targets - applied
        if missing:
            _refuse(f"{phase[0]}.{phase[1]} lacks {len(missing)} original target records")
        missing = BASELINE_PHASES[phase]["requires"] - applied
        if missing:
            _refuse(f"{phase[0]}.{phase[1]} lacks {len(missing)} phase prerequisites")
        completed.update(targets)

    if originals != completed:
        _refuse("old project records do not match the complete recorded baseline phases")
