from companies.models import Company
from documents.models import DocumentRead
from users.models import UserAccount
from users.models.user_account import AccountRole


def may_review_documents(user):
    if not user.is_active or not user.is_staff or not user.has_perm("documents.view_document"):
        return False
    if Company.objects.filter(owner=user).exists():
        return False
    return not UserAccount.objects.for_holder(user).filter(role__in=[AccountRole.COMPANY, AccountRole.BOTH]).exists()


def record_document_read(user, document, kind):
    DocumentRead.objects.create(
        actor_id=user.pk,
        document_uuid=document.pk,
        classification_uuid=document.classification_id,
        kind=kind,
    )
