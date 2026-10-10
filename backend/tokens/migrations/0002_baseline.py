from decimal import Decimal

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [("tokens", "0107_company_register_paid_issue_guards")]

    initial = True

    dependencies = [
        ("assets", "0001_baseline"),
        ("authentication", "__first__"),
        ("blockchain", "0001_baseline"),
        ("companies", "0002_baseline"),
        ("offerings", "0002_baseline"),
        ("tokens", "0001_baseline"),
        ("users", "0001_baseline"),
        ("wallets", "0001_baseline"),
        ("whitelist", "0001_baseline"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderactionsubmission",
            name="eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="executed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="initiated_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="owner_account",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="wallet",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="+", to="wallets.wallet"),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="initiated_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="owner_account",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="wallet",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="+", to="wallets.wallet"),
        ),
        migrations.AddField(
            model_name="pausechange",
            name="initiated_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="pausechange",
            name="operation",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="pause_change",
                to="blockchain.outgoingoperation",
            ),
        ),
        migrations.AddField(
            model_name="registeracknowledgement",
            name="appointment",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_capital_increases",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="request",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_instruction",
                to="tokens.capitalincreaserequest",
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="capitalincreaseexecution",
            name="source_increase",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="executions",
                to="tokens.registercapitalincrease",
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincreasedecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincreasedecision",
            name="capital_increase",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="decisions",
                to="tokens.registercapitalincrease",
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincreasedecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registercapitalincreasedecision",
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_corrections", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registercorrectiondecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registercorrectiondecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registercorrectiondecision",
            name="register_correction",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registercorrection"
            ),
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_deployments", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerdeploymentdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerdeploymentdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerdeploymentdecision",
            name="register_deployment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerdeployment"
            ),
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerdeploymentdecision",
            ),
        ),
        migrations.AddField(
            model_name="registerentry",
            name="corrects",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="correction",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registerentry",
            name="recorded_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="applied_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="approved_correction",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="corrects",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="proposals", to="tokens.registerentry"
            ),
        ),
        migrations.AddField(
            model_name="registerevidence",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerevidence",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_evidence", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registerevidence",
            name="uploaded_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="acceptance_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_grants", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="register_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="grant",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="terms_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registergrantdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registergrantdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registergrantdecision",
            name="register_grant",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registergrant"
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="asic_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_imports", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="register_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="importedformermember",
            name="source_import",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="former_members_rows",
                to="tokens.registerimport",
            ),
        ),
        migrations.AddField(
            model_name="registerimportdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerimportdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerimportdecision",
            name="register_import",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerimport"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="acceptance_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_instructions",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="nomination",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.companywalletnomination",
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="paid_subscription",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="offerings.subscription"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="terms_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="wallet_approval",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="whitelist.whitelistchange"
            ),
        ),
        migrations.AddField(
            model_name="registerinstructiondecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerinstructiondecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerinstructiondecision",
            name="instruction",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerinstruction"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerinstructiondecision",
            ),
        ),
        migrations.AddField(
            model_name="registermember",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_members", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="member",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="member_cessations", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="entry",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="member_cessations", to="tokens.registerentry"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="member",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="cessations", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="returned_entry",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="member_returns",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="member",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="particulars", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_grant",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registergrant",
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_import",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registerimport",
            ),
        ),
        migrations.AddField(
            model_name="registermemberwallet",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_wallets", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registermemberwallet",
            name="member",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="wallets", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="applied_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="approved_opening",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_openings", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registeropeningdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registeropeningdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registeropeningdecision",
            name="register_opening",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registeropening"
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschange",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_particulars_changes",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschange",
            name="member",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars_changes",
                to="tokens.registermember",
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschange",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschange",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschange",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschange",
            name="supporting_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_change",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registerparticularschange",
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschangedecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschangedecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerparticularschangedecision",
            name="register_particulars_change",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="decisions",
                to="tokens.registerparticularschange",
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_pause_changes",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="pausechange",
            name="source_pause",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="execution",
                to="tokens.registerpausechange",
            ),
        ),
        migrations.AddField(
            model_name="registerpausechangedecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechangedecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerpausechangedecision",
            name="pause_change",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerpausechange"
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="approval_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerpausechangedecision",
            ),
        ),
        migrations.AddField(
            model_name="registerposition",
            name="last_entry",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerentry"
            ),
        ),
        migrations.AddField(
            model_name="registerposition",
            name="member",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="positions", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registeracknowledgement",
            name="reconciliation",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="acknowledgements",
                to="tokens.registerreconciliation",
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="authority_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_transfers", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="instrument_evidence",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="register_entry",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="direct_transfer",
                to="tokens.registerentry",
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_transfer",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registertransfer",
            ),
        ),
        migrations.AddField(
            model_name="registertransferdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registertransferdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registertransferdecision",
            name="register_transfer",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registertransfer"
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlink",
            name="authority_evidence",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerevidence"
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlink",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_wallet_links",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlink",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlink",
            name="reviewed_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlink",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlinkdecision",
            name="appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlinkdecision",
            name="decided_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registerwalletlinkdecision",
            name="register_wallet_link",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="decisions", to="tokens.registerwalletlink"
            ),
        ),
        migrations.AddField(
            model_name="shareissuance",
            name="initiated_by",
            field=models.ForeignKey(
                blank=True,
                help_text="User who initiated the issuance",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="initiated_issuances",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="shareissuance",
            name="transaction",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="share_issuances",
                to="blockchain.blockchaintransaction",
            ),
        ),
        migrations.AddField(
            model_name="capitalincreaserequest",
            name="executed_issuance",
            field=models.OneToOneField(
                blank=True,
                help_text="The executed ShareIssuance record for the minted shares",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s",
                to="tokens.shareissuance",
            ),
        ),
        migrations.AddField(
            model_name="shareissuanceexecution",
            name="operation",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="share_issuance",
                to="blockchain.outgoingoperation",
            ),
        ),
        migrations.AddField(
            model_name="shareissuanceexecution",
            name="source_instruction",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="executions",
                to="tokens.registerinstruction",
            ),
        ),
        migrations.AddField(
            model_name="shareissuanceexecution",
            name="transaction",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="issuance_executions",
                to="blockchain.blockchaintransaction",
            ),
        ),
        migrations.AddField(
            model_name="shareissuancerequest",
            name="company",
            field=models.ForeignKey(
                help_text="Owner, derived from token.company and held directly so a row-level security policy can read it",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="shareissuancerequest",
            name="executed_issuance",
            field=models.OneToOneField(
                blank=True,
                help_text="The executed ShareIssuance record for the minted shares",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="%(class)s",
                to="tokens.shareissuance",
            ),
        ),
        migrations.AddField(
            model_name="shareissuancerequest",
            name="reviewed_by",
            field=models.ForeignKey(
                blank=True,
                help_text="Staff member who reviewed the request",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="reviewed_%(class)ss",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="shareissuancerequest",
            name="submitted_by",
            field=models.ForeignKey(
                blank=True,
                help_text="User who submitted the request",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="submitted_%(class)ss",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="request",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_instruction",
                to="tokens.shareissuancerequest",
            ),
        ),
        migrations.AddField(
            model_name="shareregister",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="registers", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registerposition",
            name="register",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="positions", to="tokens.shareregister"
            ),
        ),
        migrations.AddField(
            model_name="registermembercessation",
            name="register",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="member_cessations", to="tokens.shareregister"
            ),
        ),
        migrations.AddField(
            model_name="registerentry",
            name="register",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="entries", to="tokens.shareregister"
            ),
        ),
        migrations.AddField(
            model_name="registercorrection",
            name="register",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="corrections", to="tokens.shareregister"
            ),
        ),
        migrations.AddField(
            model_name="sharetoken",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="tokens", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="sharetoken",
            name="deployment_transaction",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="deployed_share_tokens",
                to="blockchain.blockchaintransaction",
            ),
        ),
        migrations.AddField(
            model_name="shareregister",
            name="token",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="stored_register", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="shareissuancerequest",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="issuance_requests", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="shareissuance",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="issuances", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registertransfer",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_transfers", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registerreconciliation",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_reconciliations",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="registerpausechange",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_pause_changes",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="registeropening",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_openings", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registerinstruction",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_instructions",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_imports", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registergrant",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_grants", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registerexport",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.DO_NOTHING, related_name="register_exports", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registerdeployment",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="register_deployments", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="registercapitalincrease",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="register_capital_increases",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="importedformermember",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="imported_former_members",
                to="tokens.sharetoken",
            ),
        ),
        migrations.AddField(
            model_name="formerholder",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="former_holders", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="capitalincreaserequest",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="capital_increase_requests",
                to="tokens.sharetoken",
            ),
        ),
        migrations.CreateModel(
            name="RegisterOutput",
            fields=[],
            options={
                "verbose_name": "register outputs",
                "verbose_name_plural": "register outputs",
                "proxy": True,
                "indexes": [],
                "constraints": [],
            },
            bases=("tokens.sharetoken",),
        ),
        migrations.AddField(
            model_name="signingchallenge",
            name="action",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="challenges",
                to="tokens.orderactionsubmission",
            ),
        ),
        migrations.AddField(
            model_name="signingchallenge",
            name="submission",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="challenges",
                to="tokens.ordersubmission",
            ),
        ),
        migrations.AddField(
            model_name="signingchallenge",
            name="wallet",
            field=models.ForeignKey(
                blank=True,
                help_text="Owner. Supplied by the service, which holds the authenticated caller's wallet; null only for rows written before this column, whose address named no wallet or more than one",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="wallets.wallet",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="executed_challenge",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="execution",
                to="tokens.signingchallenge",
            ),
        ),
        migrations.AddField(
            model_name="ordermodificationlog",
            name="challenge",
            field=models.ForeignKey(
                blank=True,
                help_text="The signing challenge that authorized this modification, and the message it carried.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="modification_logs",
                to="tokens.signingchallenge",
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="executed_challenge",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="action_execution",
                to="tokens.signingchallenge",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="buyer_eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="buyer_wallet",
            field=models.ForeignKey(
                help_text="Buyer, derived from buy_order.wallet and held directly so a row-level security policy can read it",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="wallets.wallet",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="payment_asset",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="swap_orders", to="assets.asset"
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="seller_eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="seller_wallet",
            field=models.ForeignKey(
                help_text="Seller, derived from sell_order.wallet and held directly so a row-level security policy can read it",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="wallets.wallet",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="share_token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="swap_orders", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="transaction",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="swap_orders",
                to="blockchain.blockchaintransaction",
            ),
        ),
        migrations.AddField(
            model_name="swapapprovalsubmission",
            name="swap",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="approval_submissions",
                to="tokens.swaporder",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="initial_swap",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.swaporder",
            ),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_operation",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="swap_approval",
                to="blockchain.outgoingoperation",
            ),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="approval_transaction",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="swap_approvals",
                to="blockchain.blockchaintransaction",
            ),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="operation",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="token_deployment",
                to="blockchain.outgoingoperation",
            ),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="source_deployment",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="execution",
                to="tokens.registerdeployment",
            ),
        ),
        migrations.AddField(
            model_name="tokendeployment",
            name="transaction",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="token_deployments",
                to="blockchain.blockchaintransaction",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="creation_submission",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.ordersubmission",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="last_modification_action",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.orderactionsubmission",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="last_modification_eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="matched_order",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="matched_by",
                to="tokens.transferorder",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="owner_account",
            field=models.ForeignKey(
                help_text="Immutable tenant snapshot for this order.",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="transfer_orders",
                to="users.useraccount",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="payment_asset",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="transfer_orders",
                to="assets.asset",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="transfer_orders", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="wallet",
            field=models.ForeignKey(
                help_text="Verified tenant wallet that owns this order.",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="transfer_orders",
                to="wallets.wallet",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="buy_order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="swap_as_buy", to="tokens.transferorder"
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="sell_order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="swap_as_sell", to="tokens.transferorder"
            ),
        ),
        migrations.AddField(
            model_name="signingchallenge",
            name="order",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="signing_challenges",
                to="tokens.transferorder",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="initial_counter_order",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.transferorder",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="order",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="submission",
                to="tokens.transferorder",
            ),
        ),
        migrations.AddField(
            model_name="ordermodificationlog",
            name="order",
            field=models.ForeignKey(
                help_text="The order that was modified.",
                on_delete=django.db.models.deletion.CASCADE,
                related_name="modification_logs",
                to="tokens.transferorder",
            ),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="actions", to="tokens.transferorder"
            ),
        ),
        migrations.AddField(
            model_name="navupdate",
            name="yield_token",
            field=models.ForeignKey(
                help_text="The yield token whose NAV was updated",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="nav_updates",
                to="tokens.yieldtoken",
            ),
        ),
        migrations.AddField(
            model_name="mintrequest",
            name="yield_token",
            field=models.ForeignKey(
                blank=True,
                help_text="The yield token being minted (if applicable)",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="mint_requests",
                to="tokens.yieldtoken",
            ),
        ),
        migrations.AddConstraint(
            model_name="registercapitalincreasedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_capital_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registercapitalincreasedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("capital_increase",),
                name="one_register_capital_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registercorrectiondecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_correction_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registercorrectiondecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_correction",),
                name="one_register_correction_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerdeploymentdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_deployment_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerdeploymentdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_deployment",),
                name="one_register_deployment_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerevidence",
            constraint=models.UniqueConstraint(
                fields=("uploaded_by", "idempotency_key"), name="one_register_evidence_per_upload_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerevidence",
            constraint=models.CheckConstraint(
                condition=models.Q(("file_size__gt", 0)), name="register_evidence_has_content"
            ),
        ),
        migrations.AddConstraint(
            model_name="registergrantdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_grant_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registergrantdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_grant",),
                name="one_register_grant_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimportdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_import_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimportdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_import",),
                name="one_register_import_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerinstructiondecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_issue_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerinstructiondecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("instruction",),
                name="one_register_issue_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberwallet",
            constraint=models.UniqueConstraint(fields=("company", "address"), name="register_wallet_company_address"),
        ),
        migrations.AddConstraint(
            model_name="registeropeningdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_opening_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registeropeningdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_opening",),
                name="one_register_opening_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerparticularschangedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_particulars_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerparticularschangedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_particulars_change",),
                name="one_register_particulars_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.UniqueConstraint(
                condition=models.Q(("completed_at__isnull", True)),
                fields=("chain_id", "contract_address"),
                name="one_unresolved_token_pause",
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(condition=models.Q(("chain_id__gt", 0)), name="pause_change_chain"),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(
                condition=models.Q(("contract_address__regex", "^0x[0-9a-f]{40}$")), name="pause_change_address"
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(
                condition=models.Q(("authority__in", ["issuer", "staff", "company"])), name="pause_change_authority"
            ),
        ),
        migrations.AddConstraint(
            model_name="pausechange",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["pending", "executing", "observed", "confirmed", "failed"])),
                name="pause_change_status",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerpausechangedecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_pause_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerpausechangedecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("pause_change",),
                name="one_register_pause_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registeracknowledgement",
            constraint=models.UniqueConstraint(
                fields=("reconciliation", "discrepancy"), name="register_acknowledged_once"
            ),
        ),
        migrations.AddConstraint(
            model_name="registeracknowledgement",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("appointment__isnull", True), ("idempotency_key__isnull", True)),
                    models.Q(("appointment__isnull", False), ("idempotency_key__isnull", False)),
                    _connector="OR",
                ),
                name="register_acknowledgement_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registeracknowledgement",
            constraint=models.UniqueConstraint(
                condition=models.Q(("idempotency_key__isnull", False)),
                fields=("acknowledged_by_id", "idempotency_key"),
                name="one_register_acknowledgement_per_key",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", False),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
            ),
        ),
        migrations.AddConstraint(
            model_name="registertransferdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_transfer_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registertransferdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_transfer",),
                name="one_register_transfer_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlink",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("authority_evidence__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("source_document__isnull", False),
                    ),
                    models.Q(
                        ("authority_evidence__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("source_document__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_wallet_link_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlinkdecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="one_register_wallet_link_decision_per_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerwalletlinkdecision",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind__in", ["apply", "reject"])),
                fields=("register_wallet_link",),
                name="one_register_wallet_link_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerposition",
            constraint=models.UniqueConstraint(fields=("register", "member"), name="register_member_position"),
        ),
        migrations.AddConstraint(
            model_name="registerposition",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gte", 0)), name="register_position_nonnegative"
            ),
        ),
        migrations.AddConstraint(
            model_name="registermembercessation",
            constraint=models.UniqueConstraint(fields=("member", "entry"), name="one_member_cessation_per_entry"),
        ),
        migrations.AddConstraint(
            model_name="registermembercessation",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares_at_cessation__gt", 0)), name="register_cessation_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerentry",
            constraint=models.UniqueConstraint(fields=("register", "sequence"), name="register_entry_sequence"),
        ),
        migrations.AddConstraint(
            model_name="registerentry",
            constraint=models.UniqueConstraint(fields=("register", "operation_id"), name="register_entry_operation"),
        ),
        migrations.AddConstraint(
            model_name="registercorrection",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("authority_evidence__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("source_document__isnull", False),
                    ),
                    models.Q(
                        ("authority_evidence__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("source_document__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_correction_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="sharetoken",
            constraint=models.CheckConstraint(condition=models.Q(("decimals", 0)), name="share_token_whole_units"),
        ),
        migrations.AddConstraint(
            model_name="sharetoken",
            constraint=models.UniqueConstraint(fields=("company", "symbol"), name="unique_company_symbol"),
        ),
        migrations.AddIndex(
            model_name="shareissuancerequest",
            index=models.Index(fields=["token", "status"], name="tokens_shar_token_i_d88bfe_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuancerequest",
            index=models.Index(fields=["status"], name="tokens_shar_status_a2f450_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuance",
            index=models.Index(fields=["token", "status"], name="tokens_shar_token_i_02da62_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuance",
            index=models.Index(fields=["recipient_address"], name="tokens_shar_recipie_43e93e_idx"),
        ),
        migrations.AddIndex(
            model_name="shareissuance",
            index=models.Index(fields=["tx_hash"], name="tokens_shar_tx_hash_e61cbd_idx"),
        ),
        migrations.AddConstraint(
            model_name="registertransfer",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_transfer_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registertransfer",
            constraint=models.CheckConstraint(
                condition=models.Q(("from_member", models.F("to_member")), _negated=True),
                name="register_transfer_distinct_members",
            ),
        ),
        migrations.AddConstraint(
            model_name="registeropening",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("authority_evidence__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("source_document__isnull", False),
                    ),
                    models.Q(
                        ("authority_evidence__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("source_document__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_opening_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "applied")),
                fields=("token",),
                name="one_applied_register_import_per_class",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("asic_document__isnull", False),
                        ("asic_evidence__isnull", True),
                        ("asic_file", ""),
                        ("asic_snapshot__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("register_evidence__isnull", True),
                        ("source_document__isnull", False),
                    ),
                    models.Q(
                        ("asic_document__isnull", True),
                        ("asic_evidence__isnull", False),
                        ("asic_issued_total__isnull", False),
                        ("asic_member_count__isnull", False),
                        ("asic_snapshot__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("register_evidence__isnull", False),
                        ("source_document__isnull", True),
                        models.Q(("asic_file", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_import_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registergrant",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="register_grant_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "inspection_copy"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("late__isnull", False),
                        ("requested_on__isnull", False),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                        models.Q(("recipient__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_inspection_copy_request",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "register_csv"), _negated=True),
                    models.Q(
                        ("digest", ""),
                        ("instruction", ""),
                        ("late__isnull", True),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_export_csv_carries_no_request",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "certificate"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("former_rows", 0),
                        ("late__isnull", True),
                        ("member_rows__gte", 1),
                        ("member_rows__lte", 2),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_certificate_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "notice_figures"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("former_rows", 0),
                        ("late__isnull", True),
                        ("period_from__isnull", False),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_notice_figures_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(("kind", "notice_figures"), ("period_from__isnull", True), _connector="OR"),
                name="register_export_period_only_for_notice_figures",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "company_pack"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("late__isnull", True),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                        models.Q(("recipient__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_company_pack_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="importedformermember",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares_at_cessation__gt", 0)), name="imported_former_member_positive_shares"
            ),
        ),
        migrations.AddIndex(
            model_name="formerholder",
            index=models.Index(fields=["token", "-ceased_on"], name="tokens_form_token_i_7339eb_idx"),
        ),
        migrations.AddConstraint(
            model_name="formerholder",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares_at_cessation__gt", 0)), name="former_holder_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="formerholder",
            constraint=models.UniqueConstraint(
                fields=("token", "wallet_address", "ceased_at_block"), name="one_cessation_per_wallet_per_block"
            ),
        ),
        migrations.AddIndex(
            model_name="capitalincreaserequest",
            index=models.Index(fields=["token", "status"], name="tokens_capi_token_i_e6b6f8_idx"),
        ),
        migrations.AddIndex(
            model_name="capitalincreaserequest",
            index=models.Index(fields=["status"], name="tokens_capi_status_2e7f84_idx"),
        ),
        migrations.AddConstraint(
            model_name="capitalincreaserequest",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status__in", ("submitted", "under_review", "approved", "executing"))),
                fields=("token",),
                name="one_capital_increase_in_flight_per_token",
            ),
        ),
        migrations.AddIndex(
            model_name="swapapprovalsubmission",
            index=models.Index(
                condition=models.Q(("outcome", "pending")),
                fields=["updated_at", "created_at", "uuid"],
                name="pending_swap_approval_recovery",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.UniqueConstraint(
                fields=("chain_id", "tx_hash"), name="unique_swap_approval_submission_hash"
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.UniqueConstraint(
                fields=("chain_id", "sender_address", "nonce"), name="unique_swap_approval_submission_nonce"
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("chain_id__gt", 0)), name="swap_approval_submission_chain_id"
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("participant__in", ("seller", "buyer"))),
                name="swap_approval_submission_participant",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("settlement_digest__regex", "^0x[0-9a-f]{64}$"), ("tx_hash__regex", "^0x[0-9a-f]{64}$")
                ),
                name="swap_approval_submission_hashes",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("sender_address__regex", "^0x[0-9a-f]{40}$"),
                    ("spender_address__regex", "^0x[0-9a-f]{40}$"),
                    ("token_address__regex", "^0x[0-9a-f]{40}$"),
                ),
                name="swap_approval_submission_addresses",
            ),
        ),
        migrations.AddConstraint(
            model_name="swapapprovalsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("block_hash__regex", "^0x[0-9a-f]{64}$"),
                        ("block_number__isnull", False),
                        ("confirmed_at__isnull", False),
                        ("gas_used__isnull", False),
                        ("outcome__in", ("confirmed", "reverted")),
                    ),
                    models.Q(
                        ("block_hash", ""),
                        ("block_number__isnull", True),
                        ("confirmed_at__isnull", True),
                        ("gas_used__isnull", True),
                        ("outcome__in", ("pending", "superseded")),
                    ),
                    _connector="OR",
                ),
                name="swap_approval_submission_receipt_present",
            ),
        ),
        migrations.AddIndex(
            model_name="transferorder",
            index=models.Index(fields=["token", "status"], name="tokens_tran_token_i_2d56dc_idx"),
        ),
        migrations.AddIndex(
            model_name="transferorder",
            index=models.Index(fields=["wallet_address"], name="tokens_tran_wallet__ea7fe6_idx"),
        ),
        migrations.AddIndex(
            model_name="transferorder",
            index=models.Index(fields=["order_type", "status"], name="tokens_tran_order_t_944477_idx"),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("creation_submission__isnull", True), ("eligibility_decision__isnull", True)),
                    models.Q(("creation_submission__isnull", False), ("eligibility_decision__isnull", False)),
                    _connector="OR",
                ),
                name="transfer_order_eligibility_birth_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("last_modification_action__isnull", True),
                        ("last_modification_eligibility_decision__isnull", True),
                    ),
                    models.Q(
                        ("last_modification_action__isnull", False),
                        ("last_modification_eligibility_decision__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="transfer_order_modification_eligibility_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("quantity__gt", 0)), name="transfer_order_positive_quantity"
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("price_per_share__gt", 0), ("price_per_share__lt", Decimal("10000000000000000"))),
                name="transfer_order_positive_price",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("filled_quantity__gte", 0), ("filled_quantity__lte", models.F("quantity"))),
                name="transfer_order_filled_bounds",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("min_quantity__gte", 0), ("min_quantity__lte", models.F("quantity"))),
                name="transfer_order_minimum_bounds",
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
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(("order_type__in", ["buy", "sell"])), name="transfer_order_known_type"
            ),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["status"], name="tokens_swap_status_3b2095_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["seller_address"], name="tokens_swap_seller__d9b2e1_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["buyer_address"], name="tokens_swap_buyer_a_67185b_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["expires_at"], name="tokens_swap_expires_5642fe_idx"),
        ),
        migrations.AddIndex(
            model_name="swaporder",
            index=models.Index(fields=["share_token", "status"], name="tokens_swap_share_t_a18876_idx"),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("seller_eligibility_admitted_at__isnull", True), ("seller_eligibility_decision__isnull", True)
                    ),
                    models.Q(
                        ("seller_eligibility_admitted_at__isnull", False),
                        ("seller_eligibility_decision__isnull", False),
                        models.Q(("seller_signature", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="swap_seller_eligibility_signature_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("buyer_eligibility_admitted_at__isnull", True), ("buyer_eligibility_decision__isnull", True)
                    ),
                    models.Q(
                        ("buyer_eligibility_admitted_at__isnull", False),
                        ("buyer_eligibility_decision__isnull", False),
                        models.Q(("buyer_signature", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="swap_buyer_eligibility_signature_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.UniqueConstraint(fields=("nonce",), name="unique_swap_nonce"),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(("share_amount__gt", 0)), name="swap_order_positive_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(("payment_amount__gt", 0)), name="swap_order_positive_payment"
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "status__in",
                        [
                            "created",
                            "seller_signed",
                            "buyer_signed",
                            "ready",
                            "executing",
                            "completed",
                            "failed",
                            "expired",
                        ],
                    )
                ),
                name="swap_order_known_status",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("settlement_context__isnull", True),
                        ("settlement_digest", ""),
                        ("settlement_protocol_version", 0),
                    ),
                    models.Q(
                        ("settlement_context__isnull", False),
                        ("settlement_digest__regex", "^0x[0-9a-f]{64}$"),
                        ("settlement_protocol_version", 1),
                    ),
                    _connector="OR",
                ),
                name="swap_order_settlement_context_present",
            ),
        ),
        migrations.AddIndex(
            model_name="signingchallenge",
            index=models.Index(fields=["wallet_address", "purpose"], name="signing_cha_wallet__ff224b_idx"),
        ),
        migrations.AddIndex(
            model_name="signingchallenge",
            index=models.Index(fields=["expires_at"], name="signing_cha_expires_5d4df2_idx"),
        ),
        migrations.AddConstraint(
            model_name="signingchallenge",
            constraint=models.UniqueConstraint(fields=("wallet_address", "nonce"), name="unique_nonce_per_wallet"),
        ),
        migrations.AddConstraint(
            model_name="signingchallenge",
            constraint=models.CheckConstraint(
                condition=models.Q(("submission__isnull", True), ("action__isnull", True), _connector="OR"),
                name="signing_challenge_one_intent",
            ),
        ),
        migrations.AddConstraint(
            model_name="signingchallenge",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("consumed_at__isnull", True), ("consumed_signature", "")),
                    models.Q(("consumed_at__isnull", False), models.Q(("consumed_signature", ""), _negated=True)),
                    _connector="OR",
                ),
                name="signing_challenge_complete_spend",
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("status", "created"), ("eligibility_decision__isnull", True), _connector="OR"),
                name="order_submission_eligibility_created_only",
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.UniqueConstraint(
                fields=("owner_account", "submission_id"), name="order_submission_account_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("chain_id__gt", 0),
                    ("intent_version", 1),
                    ("quantity__gt", 0),
                    ("min_quantity__gte", 0),
                    ("min_quantity__lte", models.F("quantity")),
                    ("price_per_share__gt", 0),
                    ("price_per_share__lt", Decimal("10000000000000000")),
                    ("order_type__in", ["buy", "sell"]),
                ),
                name="order_submission_valid_terms",
            ),
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
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("initial_counter_order__isnull", True), ("initial_swap__isnull", True)),
                    models.Q(("initial_counter_order__isnull", False), ("initial_swap__isnull", False)),
                    _connector="OR",
                ),
                name="order_submission_match_pair",
            ),
        ),
        migrations.AddIndex(
            model_name="ordermodificationlog",
            index=models.Index(fields=["order", "created_at"], name="tokens_orde_order_i_eb9ab0_idx"),
        ),
        migrations.AddIndex(
            model_name="ordermodificationlog",
            index=models.Index(fields=["signer_address"], name="tokens_orde_signer__b71cce_idx"),
        ),
        migrations.AddIndex(
            model_name="ordermodificationlog",
            index=models.Index(fields=["field_name"], name="tokens_orde_field_n_b2e7f3_idx"),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("eligibility_admitted_at__isnull", True), ("eligibility_decision__isnull", True)),
                    models.Q(
                        ("eligibility_admitted_at__isnull", False),
                        ("eligibility_decision__isnull", False),
                        ("purpose", "modify"),
                        ("status", "applied"),
                    ),
                    _connector="OR",
                ),
                name="order_action_eligibility_modify_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.UniqueConstraint(fields=("owner_account", "action_id"), name="order_action_account_key"),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("chain_id__gt", 0),
                    ("protocol_version", 1),
                    models.Q(
                        models.Q(
                            ("new_min_quantity__isnull", True),
                            ("new_price_per_share__isnull", True),
                            ("new_quantity__isnull", True),
                            ("purpose", "cancel"),
                        ),
                        models.Q(
                            ("new_min_quantity__gte", 0),
                            ("new_min_quantity__isnull", False),
                            ("new_price_per_share__gt", 0),
                            ("new_price_per_share__isnull", False),
                            ("new_price_per_share__lt", Decimal("10000000000000000")),
                            ("new_quantity__gt", 0),
                            ("new_quantity__isnull", False),
                            ("purpose", "modify"),
                        ),
                        _connector="OR",
                    ),
                ),
                name="order_action_valid_intent",
            ),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("executed_by__isnull", True),
                        ("executed_challenge__isnull", True),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("refusal_status__isnull", True),
                        ("resolved_at__isnull", True),
                        ("result__isnull", True),
                        ("status", "pending"),
                    ),
                    models.Q(
                        ("executed_by__isnull", False),
                        ("executed_challenge__isnull", False),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("refusal_status__isnull", True),
                        ("resolved_at__isnull", False),
                        ("result__isnull", False),
                        ("status", "applied"),
                    ),
                    models.Q(
                        ("executed_by__isnull", False),
                        ("executed_challenge__isnull", False),
                        ("refusal_status__isnull", False),
                        ("resolved_at__isnull", False),
                        ("result__isnull", True),
                        ("status", "refused"),
                        models.Q(("refusal_detail", ""), _negated=True),
                        models.Q(
                            models.Q(
                                ("purpose", "cancel"),
                                ("refusal_code", "order_cancellation_failed"),
                                ("refusal_status", 400),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "order_modification_failed"),
                                ("refusal_status", 400),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "order_modification_conflict"),
                                ("refusal_status", 409),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "investor_not_eligible"),
                                ("refusal_status", 403),
                            ),
                            _connector="OR",
                        ),
                    ),
                    _connector="OR",
                ),
                name="order_action_outcome_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="navupdate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("completed_at__isnull", True), ("mode__in", ["local", "chain"])),
                fields=("yield_token",),
                name="one_unresolved_nav_per_token",
            ),
        ),
        migrations.AddConstraint(
            model_name="navupdate",
            constraint=models.UniqueConstraint(
                models.F("intent__contract_address"),
                condition=models.Q(("completed_at__isnull", True), ("mode", "chain")),
                name="one_unresolved_nav_per_contract",
            ),
        ),
        migrations.AddIndex(
            model_name="mintrequest",
            index=models.Index(fields=["status"], name="tokens_mint_status_99ebab_idx"),
        ),
        migrations.AddIndex(
            model_name="mintrequest",
            index=models.Index(fields=["deposit_reference"], name="tokens_mint_deposit_d00e57_idx"),
        ),
        migrations.AddIndex(
            model_name="mintrequest",
            index=models.Index(fields=["recipient_address"], name="tokens_mint_recipie_c3a7c5_idx"),
        ),
    ]
