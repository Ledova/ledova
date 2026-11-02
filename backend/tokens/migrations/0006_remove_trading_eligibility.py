from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("shareholders", "0002_remove_publications"),
        ("tokens", "0005_remove_member_certificate_requests"),
        ("users", "0002_eligibility_participant_name"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="orderactionsubmission",
            name="order_action_eligibility_modify_pair",
        ),
        migrations.RemoveConstraint(
            model_name="ordersubmission",
            name="order_submission_eligibility_created_only",
        ),
        migrations.RemoveConstraint(
            model_name="swaporder",
            name="swap_seller_eligibility_signature_pair",
        ),
        migrations.RemoveConstraint(
            model_name="swaporder",
            name="swap_buyer_eligibility_signature_pair",
        ),
        migrations.RemoveConstraint(
            model_name="transferorder",
            name="transfer_order_eligibility_birth_pair",
        ),
        migrations.RemoveConstraint(
            model_name="transferorder",
            name="transfer_order_modification_eligibility_pair",
        ),
        migrations.RemoveField(
            model_name="orderactionsubmission",
            name="eligibility_admitted_at",
        ),
        migrations.RemoveField(
            model_name="orderactionsubmission",
            name="eligibility_decision",
        ),
        migrations.RemoveField(
            model_name="ordersubmission",
            name="eligibility_decision",
        ),
        migrations.RemoveField(
            model_name="swaporder",
            name="buyer_eligibility_admitted_at",
        ),
        migrations.RemoveField(
            model_name="swaporder",
            name="buyer_eligibility_decision",
        ),
        migrations.RemoveField(
            model_name="swaporder",
            name="seller_eligibility_admitted_at",
        ),
        migrations.RemoveField(
            model_name="swaporder",
            name="seller_eligibility_decision",
        ),
        migrations.RemoveField(
            model_name="transferorder",
            name="eligibility_decision",
        ),
        migrations.RemoveField(
            model_name="transferorder",
            name="last_modification_eligibility_decision",
        ),
    ]
