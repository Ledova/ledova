from django.db.models import QuerySet
from django.utils import timezone


class NotificationQuerySet(QuerySet):

    def unread(self):
        return self.filter(is_read=False)

    def not_archived(self):
        return self.filter(is_archived=False)

    def mark_all_read(self):
        return self.unread().update(is_read=True, read_at=timezone.now())

    def with_optimized_data(self):
        return self.select_related("user")
