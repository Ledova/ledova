from procrastinate import App
from procrastinate.contrib.django.django_connector import DjangoConnector

from shared.db import current_alias


def defer(task, *, using=None, schedule_in=None, **task_kwargs):
    queue = App(connector=DjangoConnector(alias=using or current_alias()))
    return queue.configure_task(
        task.name,
        queue=task.queue,
        priority=task.priority,
        lock=task.lock,
        queueing_lock=task.queueing_lock,
        schedule_in=schedule_in,
    ).defer(**task_kwargs)
