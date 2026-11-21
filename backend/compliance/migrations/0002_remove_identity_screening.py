from django.db import migrations, models
from django.db.models import Q

REMOVED_ALERT_TYPES = (
    "extreme_risk_transaction",
    "high_risk_wallet",
    "sanctioned_address",
    "pep_limit_breach",
    "sanctions_match",
    "pep_match",
    "watchlist_match",
    "sanctions_list_update",
    "periodic_review",
)
REMOVED_RULES = ("KYC-SCREEN", "REVIEW-001", "MON-004", "MON-005", "MON-011")
REMOVED_RULE_TYPES = ("address", "extreme_risk")
TASKS = ("compliance.tasks.check_periodic_reviews",)


def remove_identity_records(apps, schema_editor):
    alias = schema_editor.connection.alias
    alerts = apps.get_model("compliance", "ComplianceAlert").objects.using(alias)
    case_evidence = Q(smr_required=True) | Q(smr_filed_at__isnull=False)
    alerts.filter(Q(alert_type__in=REMOVED_ALERT_TYPES) | Q(triggered_rule__in=REMOVED_RULES)).exclude(
        case_evidence
    ).delete()
    apps.get_model("compliance", "AlertProcedureTemplate").objects.using(alias).filter(
        alert_type__in=REMOVED_ALERT_TYPES
    ).exclude(steps__checklist_items__isnull=False).delete()
    apps.get_model("compliance", "MonitoringRule").objects.using(alias).filter(
        rule_type__in=REMOVED_RULE_TYPES
    ).delete()
    apps.get_model("contenttypes", "ContentType").objects.using(alias).filter(
        app_label="compliance", model__in=("customerriskassessment", "transactionscreening")
    ).delete()
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM procrastinate_jobs WHERE status = 'todo' AND task_name = ANY(%s)", [list(TASKS)]
            )


class Migration(migrations.Migration):

    dependencies = [
        ("compliance", "0001_initial"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("procrastinate", "0042_pre_fetch_job_skip_null_lock"),
    ]

    operations = [
        migrations.RunPython(remove_identity_records, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name="customerriskassessment",
            name="compliance__user_ac_af50b2_idx",
        ),
        migrations.RemoveIndex(
            model_name="customerriskassessment",
            name="compliance__assessm_3c42b8_idx",
        ),
        migrations.RemoveIndex(
            model_name="customerriskassessment",
            name="compliance__overall_a9126d_idx",
        ),
        migrations.RemoveIndex(
            model_name="transactionscreening",
            name="compliance__status_dd0e8a_idx",
        ),
        migrations.RemoveIndex(
            model_name="transactionscreening",
            name="compliance__to_addr_4c3228_idx",
        ),
        migrations.RemoveIndex(
            model_name="transactionscreening",
            name="compliance__risk_sc_5a9620_idx",
        ),
        migrations.RemoveIndex(
            model_name="transactionscreening",
            name="compliance__user_ac_ac022c_idx",
        ),
        migrations.AlterField(
            model_name="alertproceduretemplate",
            name="alert_type",
            field=models.CharField(
                choices=[
                    ("large_transaction", "Large Transaction (≥AUD 10,000)"),
                    ("rapid_transactions", "Rapid Transactions (5+ in 1 hour)"),
                    ("structuring", "Structuring Pattern"),
                    ("high_aggregate_volume", "High Aggregate Volume (≥AUD 50,000/30 days)"),
                    ("dormant_reactivation", "Dormant Account Reactivation (90+ days)"),
                    ("pattern_deviation", "Material Pattern Deviation (3x average)"),
                    ("round_amounts", "Round Amount Transactions"),
                    ("new_customer_sof", "New Customer SOF Required"),
                    ("mixer_tumbler", "Mixer/Tumbler Involvement"),
                    ("darknet_association", "Darknet Association"),
                    ("ransomware_association", "Ransomware Association"),
                    ("adverse_media_serious", "Adverse Media (Serious)"),
                    ("adverse_media_minor", "Adverse Media (Minor)"),
                    ("info_discrepancy", "Customer Information Discrepancy"),
                    ("failed_documentation", "Failed Documentation Request"),
                    ("multiple_alerts", "Multiple Alerts (3+) Same Customer"),
                    ("law_enforcement", "Law Enforcement Inquiry"),
                    ("terrorism_financing", "Terrorism Financing Indicators"),
                    ("manual", "Manual Alert"),
                ],
                help_text="The alert type this template applies to",
                max_length=50,
                unique=True,
            ),
        ),
        migrations.AlterField(
            model_name="compliancealert",
            name="alert_type",
            field=models.CharField(
                choices=[
                    ("large_transaction", "Large Transaction (≥AUD 10,000)"),
                    ("rapid_transactions", "Rapid Transactions (5+ in 1 hour)"),
                    ("structuring", "Structuring Pattern"),
                    ("high_aggregate_volume", "High Aggregate Volume (≥AUD 50,000/30 days)"),
                    ("dormant_reactivation", "Dormant Account Reactivation (90+ days)"),
                    ("pattern_deviation", "Material Pattern Deviation (3x average)"),
                    ("round_amounts", "Round Amount Transactions"),
                    ("new_customer_sof", "New Customer SOF Required"),
                    ("mixer_tumbler", "Mixer/Tumbler Involvement"),
                    ("darknet_association", "Darknet Association"),
                    ("ransomware_association", "Ransomware Association"),
                    ("adverse_media_serious", "Adverse Media (Serious)"),
                    ("adverse_media_minor", "Adverse Media (Minor)"),
                    ("info_discrepancy", "Customer Information Discrepancy"),
                    ("failed_documentation", "Failed Documentation Request"),
                    ("multiple_alerts", "Multiple Alerts (3+) Same Customer"),
                    ("law_enforcement", "Law Enforcement Inquiry"),
                    ("terrorism_financing", "Terrorism Financing Indicators"),
                    ("manual", "Manual Alert"),
                ],
                max_length=50,
            ),
        ),
        migrations.AlterField(
            model_name="monitoringrule",
            name="rule_type",
            field=models.CharField(
                choices=[
                    ("threshold", "Large Transaction Threshold"),
                    ("rapid_transactions", "Rapid Transactions"),
                    ("pattern", "Structuring Pattern"),
                    ("sof_required", "New Customer SOF Required"),
                    ("aggregate_volume", "High Aggregate Volume"),
                    ("dormant_reactivation", "Dormant Account Reactivation"),
                    ("pattern_deviation", "Material Pattern Deviation"),
                    ("round_amounts", "Round Amount Transactions"),
                ],
                help_text="Type of check: threshold, velocity, pattern, etc.",
                max_length=30,
            ),
        ),
        migrations.RemoveField(
            model_name="transactionscreening",
            name="transaction",
        ),
        migrations.RemoveField(
            model_name="transactionscreening",
            name="user_account",
        ),
        migrations.DeleteModel(
            name="CustomerRiskAssessment",
        ),
        migrations.DeleteModel(
            name="TransactionScreening",
        ),
    ]
