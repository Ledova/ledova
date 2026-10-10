import atexit
import shutil
import tempfile
from copy import deepcopy

from ledova_backend.chain_safety import APPROVED_FINALITY_POLICIES

from . import *  # noqa: F401,F403
from .database import DATABASES as POSTGRES_DATABASES

DATABASES = deepcopy(POSTGRES_DATABASES)
DATABASES["default"]["CONN_MAX_AGE"] = 0
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
STORAGE_BACKEND = "local"
BLOCKCHAIN_CHAIN_ID = 84532
WALLET_CHAIN_FINALITY_POLICIES = deepcopy(APPROVED_FINALITY_POLICIES)
MEDIA_ROOT = tempfile.mkdtemp(prefix="ledova-test-media-")
PRIVATE_MEDIA_ROOT = tempfile.mkdtemp(prefix="ledova-test-private-media-")

atexit.register(shutil.rmtree, MEDIA_ROOT, ignore_errors=True)
atexit.register(shutil.rmtree, PRIVATE_MEDIA_ROOT, ignore_errors=True)

RLS_AMBIENT_ALIAS = "default"

RLS_ROLE_PER_REQUEST = True
TEST_RUNNER = "shared.test_runner.LedovaTestRunner"
