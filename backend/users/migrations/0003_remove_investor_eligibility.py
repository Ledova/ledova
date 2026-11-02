from functools import partial

from django.conf import settings
from django.db import migrations

from shared.db import on_commit
from shared.db.policy_sql import install as install_policies
from tokens import database_guards as tokens_guards
from tokens.database_mirror_guards import _function
from users import database_guards as users_guards
from whitelist import database_guards as whitelist_guards

TASKS = ("users.tasks.retention.purge_classification_evidence",)
MODELS = (
    "investorclassification",
    "companyeligibilityrequest",
    "companyeligibilitydecision",
    "companyeligibilityrequestwithdrawal",
    "companyeligibilityrevocation",
)

REPLACED = (
    (users_guards.SQL, "users_participant_current"),
    (whitelist_guards.SQL, "whitelist_eligibility_invalidation_cause"),
    (whitelist_guards.SQL, "whitelist_wallet_nomination_current"),
    (whitelist_guards.SQL, "whitelist_company_wallet_ready"),
    (whitelist_guards.SQL, "whitelist_guard_invalidation_change"),
    (whitelist_guards.SQL, "whitelist_guard_wallet_nomination"),
    (whitelist_guards.SQL, "whitelist_lock_eligibility_invalidation"),
    (tokens_guards.SQL, "tokens_trading_command"),
    (tokens_guards.SQL, "tokens_trading_binding"),
    (tokens_guards.SQL, "tokens_trading_current"),
    (tokens_guards.SQL, "tokens_lock_trading_admission"),
    (tokens_guards.SQL, "tokens_guard_trading_action"),
    (tokens_guards.SQL, "tokens_guard_trading_log"),
    (tokens_guards.SQL, "tokens_guard_trading_order"),
    (tokens_guards.SQL, "tokens_guard_trading_submission"),
    (tokens_guards.SQL, "tokens_guard_trading_swap"),
    (tokens_guards.SQL, "tokens_check_trading_birth"),
    (tokens_guards.SQL, "tokens_check_trading_modification"),
    (tokens_guards.SQL, "tokens_register_issue_ready"),
)

REMOVED = (
    "DROP FUNCTION IF EXISTS whitelist_eligibility_invalidation_cause(uuid, text, uuid)",
    "DROP FUNCTION IF EXISTS app_company_eligibility_ids()",
    "DROP FUNCTION IF EXISTS users_company_eligibility_decision_current(uuid, uuid, uuid, timestamptz)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_decision_facts_current(uuid, uuid, uuid, timestamptz)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_summary(uuid, uuid, timestamptz)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_source_current(uuid, uuid, timestamptz)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_metadata_digest(uuid)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_certificate_time_zone()",
    "DROP FUNCTION IF EXISTS users_company_eligibility_certificate_expiry(date)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_stamp(timestamptz)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_hash(jsonb)",
    "DROP FUNCTION IF EXISTS users_company_eligibility_nonblank(text)",
    "DROP FUNCTION IF EXISTS users_guard_company_eligibility()",
    "DROP FUNCTION IF EXISTS users_begin_company_eligibility()",
    "DROP FUNCTION IF EXISTS users_lock_company_eligibility_context()",
    "DROP FUNCTION IF EXISTS users_refuse_retired_classification_review()",
    "DROP FUNCTION IF EXISTS users_guard_classification_evidence()",
    "DROP FUNCTION IF EXISTS users_lock_classification_evidence_command()",
    "DROP FUNCTION IF EXISTS users_classification_evidence_purge_due(uuid)",
    "DROP FUNCTION IF EXISTS documents_guard_evidence()",
    "DROP FUNCTION IF EXISTS documents_lock_evidence_command()",
    "DROP FUNCTION IF EXISTS documents_evidence_purge_due(uuid)",
    "DROP FUNCTION IF EXISTS users_unattached_document_retention_days()",
    "DROP FUNCTION IF EXISTS users_classification_evidence_retention_days()",
)


def remove_evidence_files(apps, schema_editor):
    alias = schema_editor.connection.alias
    claims = apps.get_model("users", "InvestorClassification").objects.using(alias)
    for claim in claims.exclude(evidence_file="").exclude(evidence_file__isnull=True).only("evidence_file"):
        on_commit(partial(claim.evidence_file.storage.delete, claim.evidence_file.name), using=alias)


def remove_eligibility_guards(apps, schema_editor):
    alias = schema_editor.connection.alias
    apps.get_model("contenttypes", "ContentType").objects.using(alias).filter(
        app_label="users", model__in=MODELS
    ).delete()
    apps.get_model("auth", "Group").objects.using(alias).filter(
        name="Document operations", permissions__isnull=True
    ).delete()
    if schema_editor.connection.vendor != "postgresql":
        return
    install_policies(schema_editor)
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for source, name in REPLACED:
            cursor.execute(
                _function(source, name)
                .replace("__OPERATOR__", operator)
                .replace("__MIGRATE__", migrate)
                .replace("__APP__", app)
            )
        for statement in REMOVED:
            cursor.execute(statement)
        cursor.execute("DELETE FROM procrastinate_jobs WHERE status = 'todo' AND task_name = ANY(%s)", [list(TASKS)])


class Migration(migrations.Migration):

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("documents", "0002_remove_documents"),
        ("tokens", "0006_remove_trading_eligibility"),
        ("users", "0002_eligibility_participant_name"),
        ("whitelist", "0002_remove_wallet_eligibility"),
    ]

    operations = [
        migrations.RunPython(remove_evidence_files),
        migrations.DeleteModel(
            name="CompanyEligibilityRevocation",
        ),
        migrations.DeleteModel(
            name="CompanyEligibilityRequestWithdrawal",
        ),
        migrations.DeleteModel(
            name="CompanyEligibilityDecision",
        ),
        migrations.DeleteModel(
            name="CompanyEligibilityRequest",
        ),
        migrations.DeleteModel(
            name="InvestorClassification",
        ),
        migrations.RunPython(remove_eligibility_guards),
    ]
