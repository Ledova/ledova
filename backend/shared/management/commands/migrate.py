from django.core.management.commands.migrate import Command as DjangoMigrate
from django.db import connections

from shared.db import use_migrate
from shared.db.migration_baseline import require_baseline_history


class Command(DjangoMigrate):

    def handle(self, *args, **options):
        with use_migrate():
            require_baseline_history(connections[options["database"]])
            return super().handle(*args, **options)
