from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("users", "0025_remove_unread_preferences")]

    operations = [migrations.DeleteModel(name="FavouriteAsset")]
