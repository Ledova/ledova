import logging

from django.db import connections
from django.utils import timezone

from documents.models import Document
from shared.db import atomic, current_alias, use_operator
from users.models import InvestorClassification
from users.services.investor_classification import (
    evidence_operation,
    require_evidence_retention_policy,
)

logger = logging.getLogger(__name__)


def purge_document(document_uuid, moment):
    with use_operator(), atomic():
        require_evidence_retention_policy()
        captured = Document.objects.filter(pk=document_uuid).values("classification_id").first()
        if captured is None:
            return False
        source_id = captured["classification_id"]
        with evidence_operation("purge_document", source_id=source_id, document_id=document_uuid), atomic():
            if source_id:
                InvestorClassification.objects.select_for_update().get(pk=source_id)
            document = Document.objects.select_for_update().get(pk=document_uuid)
            if document.classification_id != source_id:
                return False
            list(document.extractions.select_for_update().order_by("pk").values_list("pk", flat=True))
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT documents_evidence_purge_due(%s)", [document.pk])
                if not cursor.fetchone()[0]:
                    return False
            document.file.delete(save=False)
            document.extractions.all().delete()
            document.original_filename = ""
            document.note = ""
            document.mime_type = ""
            document.purged_at = timezone.now()
            document.save(update_fields=["file", "original_filename", "note", "mime_type", "purged_at", "updated_at"])
            return True


def purge_expired_documents(moment, limit=200):
    purged = failed = 0
    with use_operator():
        require_evidence_retention_policy()
        candidates_at = min(moment, timezone.now())
        ids = list(
            Document.objects.retention_due(candidates_at).order_by("created_at").values_list("pk", flat=True)[:limit]
        )
        for document_uuid in ids:
            try:
                purged += int(purge_document(document_uuid, moment))
            except Exception:
                failed += 1
                logger.error("Supporting document purge failed for %s", document_uuid, exc_info=True)
    return {"purged": purged, "failed": failed}
