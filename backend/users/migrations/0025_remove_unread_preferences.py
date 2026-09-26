from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0024_remove_useraccount_director"),
    ]

    operations = [
        migrations.RemoveField(model_name="notificationpreferences", name="marketing"),
        migrations.RemoveField(model_name="notificationpreferences", name="price_alerts"),
        migrations.RemoveField(model_name="userpreferences", name="display_currency"),
        migrations.AlterField(
            model_name="notification",
            name="notification_type",
            field=models.CharField(
                choices=[("transaction", "Transaction"), ("general", "General"), ("system", "System")],
                default="general",
                help_text="Category of the notification",
                max_length=20,
            ),
        ),
    ]
