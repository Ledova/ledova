from decimal import Decimal

from django.db import migrations, models

AUD_PAR = {"AUDY": Decimal("1.00")}
CENT = Decimal("0.01")


def value_each_transaction_in_aud(apps, schema_editor):
    transaction = apps.get_model("wallets", "Transaction")
    exchange_rate = apps.get_model("assets", "ExchangeRate")
    alias = schema_editor.connection.alias
    stored = exchange_rate._base_manager.using(alias).filter(base_currency="USD", target_currency="AUD").first()
    rate = stored.rate if stored is not None and stored.rate > 0 else None
    rows = transaction._base_manager.using(alias).filter(market_value_aud__isnull=True).select_related("asset")
    for row in rows.iterator():
        par = AUD_PAR.get(row.asset.symbol) if row.asset.is_verified else None
        if par is not None:
            value = abs(row.amount) * par
        elif row.market_value is not None and rate is not None:
            value = row.market_value * rate
        else:
            continue
        transaction._base_manager.using(alias).filter(pk=row.pk).update(market_value_aud=value.quantize(CENT))


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0014_native_chain_deployments"),
        ("wallets", "0022_delete_holdingsnapshot"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="market_value_aud",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text=(
                    "AUD value at transaction time, which transaction monitoring compares with its AUD thresholds: "
                    "the USD value at the USD/AUD rate stored when the transaction was recorded, or amount × par "
                    "for an asset with an AUD par"
                ),
                max_digits=30,
                null=True,
            ),
        ),
        migrations.RunPython(value_each_transaction_in_aud, migrations.RunPython.noop),
    ]
