from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0078_register_notice_figures"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="ordersubmission",
            name="order_submission_outcome_shape",
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("executed_challenge__isnull", True),
                        ("initial_counter_order__isnull", True),
                        ("initial_swap__isnull", True),
                        ("order__isnull", True),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("resolved_at__isnull", True),
                        ("status", "pending"),
                    ),
                    models.Q(
                        ("executed_challenge__isnull", False),
                        ("order__isnull", False),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("resolved_at__isnull", False),
                        ("status", "created"),
                    ),
                    models.Q(
                        ("executed_challenge__isnull", False),
                        ("initial_counter_order__isnull", True),
                        ("initial_swap__isnull", True),
                        ("order__isnull", True),
                        (
                            "refusal_code__in",
                            [
                                "not_whitelisted",
                                "insufficient_balance",
                                "invalid_settlement_amount",
                                "settlement_chain_disagreement",
                                "investor_not_eligible",
                            ],
                        ),
                        ("resolved_at__isnull", False),
                        ("status", "refused"),
                        models.Q(("refusal_detail", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="order_submission_outcome_shape",
            ),
        ),
    ]
