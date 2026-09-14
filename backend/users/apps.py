from importlib import import_module

from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "users"
    verbose_name = "2 - Users"

    def ready(self):
        import_module("users.schema")
