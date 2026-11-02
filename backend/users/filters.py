import django_filters

from users.models.notification import Notification


class NotificationFilter(django_filters.FilterSet):
    notification_type = django_filters.CharFilter()
    is_read = django_filters.BooleanFilter()
    is_archived = django_filters.BooleanFilter()

    class Meta:
        model = Notification
        fields = []
