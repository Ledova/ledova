import os
import re

from django.apps import apps
from django.conf import settings
from django.core.files.storage import FileSystemStorage, storages
from django.db import models

from shared.db import on_commit

PRIVATE_STORAGE_ALIAS = "private"

SWEPT_STORAGE_PREFIXES = ("companies", "documents", "users")

RETAINED_STORAGE_PATHS = re.compile(r"companies/[^/]+/publications/")


class PrivateMediaStorage(FileSystemStorage):

    @property
    def base_location(self):
        return settings.PRIVATE_MEDIA_ROOT

    @property
    def location(self):
        return os.path.abspath(self.base_location)

    @property
    def base_url(self):
        return None


def private_storage():
    return storages[PRIVATE_STORAGE_ALIAS]


def private_file_fields():
    for model in apps.get_models():
        for field in model._meta.get_fields():
            if not isinstance(field, models.FileField):
                continue
            if (
                field.deconstruct()[3].get("storage") is private_storage
                or field.storage is private_storage()
                or isinstance(field.storage, PrivateMediaStorage)
            ):
                yield model, field.name


def _delete_stored_file(storage, name):
    def delete():
        storage.delete(name)

    on_commit(delete)


def delete_file_when_the_row_is_gone(field_name):
    def receiver(sender, instance, **kwargs):
        stored = getattr(instance, field_name, None)
        if stored and stored.name:
            _delete_stored_file(stored.storage, stored.name)

    return receiver
