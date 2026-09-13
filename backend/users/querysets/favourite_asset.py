from django.db.models import QuerySet


class FavouriteAssetQuerySet(QuerySet):

    def with_optimized_data(self):
        return self.select_related("user_account", "asset")
