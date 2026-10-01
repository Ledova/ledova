from importlib import import_module

from django.db import migrations, models

RETIRED = (("TransferOrder", ("executing", "expired", "failed")), ("MintRequest", ("approved",)))
CANCELLABLE = "COALESCE(NEW.result->>'from_status', '') NOT IN ('open', 'partially_filled')"
CANCELLABLE_WHEN_HELD = "COALESCE(NEW.result->>'from_status', '') NOT IN ('open', 'partially_filled', 'held')"


def _guard(replacements=()):
    sql = import_module("tokens.migrations.0038_order_action_submissions").GUARDS
    sql = sql[: sql.index("CREATE TRIGGER")].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)
    for old, new in replacements:
        if sql.count(old) != 1:
            raise RuntimeError("The order action guard no longer has the shape this migration extends.")
        sql = sql.replace(old, new)
    return sql


PREVIOUS = _guard()
HELD_CANCELLATIONS = _guard(((CANCELLABLE, CANCELLABLE_WHEN_HELD),))


def refuse_retired_statuses(apps, schema_editor):
    found = []
    for model_name, statuses in RETIRED:
        rows = apps.get_model("tokens", model_name)._base_manager.using(schema_editor.connection.alias)
        for status in statuses:
            identifiers = list(rows.filter(status=status).order_by("pk").values_list("pk", flat=True)[:20])
            if identifiers:
                found.append(f"{model_name} {status}: " + ", ".join(str(pk) for pk in identifiers))
    if found:
        raise RuntimeError(
            "No code has ever written these statuses, yet rows hold them. First 20 identifiers per status:\n"
            + "\n".join(found)
            + "\nNo rows have been changed. Find out how each row came to hold its status and record its real "
            "outcome explicitly before retrying; do not map them in bulk."
        )


def refuse_held_orders(apps, schema_editor):
    rows = apps.get_model("tokens", "TransferOrder")._base_manager.using(schema_editor.connection.alias)
    identifiers = list(rows.filter(status="held").order_by("pk").values_list("pk", flat=True)[:20])
    if identifiers:
        raise RuntimeError(
            "Orders are held back from the book, and the earlier schema has no such status. First 20 identifiers: "
            + ", ".join(str(pk) for pk in identifiers)
            + ". No rows have been changed. Cancel or re-place them before reversing."
        )


class Migration(migrations.Migration):

    dependencies = [("tokens", "0080_company_pack")]

    operations = [
        migrations.RunPython(refuse_retired_statuses, migrations.RunPython.noop),
        migrations.RemoveConstraint(model_name="transferorder", name="transfer_order_known_status"),
        migrations.AlterField(
            model_name="mintrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("executing", "Outcome unresolved"),
                    ("executed", "Executed"),
                    ("failed", "Failed"),
                    ("rejected", "Rejected"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="transferorder",
            name="status",
            field=models.CharField(
                choices=[
                    ("open", "Open"),
                    ("partially_filled", "Partially Filled"),
                    ("held", "Held Back"),
                    ("matched", "Matched"),
                    ("pending_signature", "Pending Signature"),
                    ("completed", "Completed"),
                    ("cancelled", "Cancelled"),
                ],
                default="open",
                max_length=20,
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "status__in",
                        ["open", "partially_filled", "held", "matched", "pending_signature", "completed", "cancelled"],
                    )
                ),
                name="transfer_order_known_status",
            ),
        ),
        migrations.RunSQL(HELD_CANCELLATIONS, PREVIOUS),
        migrations.RunPython(migrations.RunPython.noop, refuse_held_orders),
    ]
