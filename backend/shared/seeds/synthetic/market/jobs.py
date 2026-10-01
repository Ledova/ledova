from django.contrib.auth import get_user_model

from shareholders.tasks import tell_the_members
from tokens.tasks.swap_reconciler import recover_swap_execution
from users.models import Notification
from users.tasks.notifications import send_push_notification

User = get_user_model()


def record_notification(user_id, title, body, data=None, notification_type="general"):
    Notification.objects.create(
        user=User.objects.get(pk=user_id),
        title=title,
        body=body,
        notification_type=notification_type,
        data=data or {},
        is_read=False,
    )
    return {"status": "recorded"}


HANDLERS = {
    recover_swap_execution.name: recover_swap_execution,
    tell_the_members.name: tell_the_members,
    send_push_notification.name: record_notification,
}


def run(deferrals):
    return deferrals.run(HANDLERS)
