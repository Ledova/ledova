from django.db import migrations

INSTALL = """
CREATE FUNCTION offerings_keep_published_documents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (TG_OP = 'DELETE'
        OR ROW(NEW.offering_id, NEW.companydocument_id) IS DISTINCT FROM ROW(OLD.offering_id, OLD.companydocument_id))
        AND EXISTS (
            SELECT 1 FROM offerings_offering published
            WHERE published.uuid = OLD.offering_id AND published.status IN ('approved', 'closed')
        )
    THEN
        RAISE EXCEPTION 'A document attached to an approved or closed offering stays attached'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER offerings_keep_published_documents BEFORE UPDATE OR DELETE ON offerings_offering_documents
FOR EACH ROW EXECUTE FUNCTION offerings_keep_published_documents();
CREATE FUNCTION offerings_keep_offered_document_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND EXISTS (
        SELECT 1 FROM offerings_offering_documents attached
        JOIN offerings_offering published ON published.uuid = attached.offering_id
        WHERE attached.companydocument_id = OLD.uuid AND published.status IN ('approved', 'closed')
    ) THEN
        RAISE EXCEPTION 'A document attached to an approved or closed offering keeps its company'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER offerings_keep_offered_document_company BEFORE UPDATE OF company_id ON companies_companydocument
FOR EACH ROW EXECUTE FUNCTION offerings_keep_offered_document_company();
"""

REMOVE = """
DROP TRIGGER offerings_keep_offered_document_company ON companies_companydocument;
DROP FUNCTION offerings_keep_offered_document_company();
DROP TRIGGER offerings_keep_published_documents ON offerings_offering_documents;
DROP FUNCTION offerings_keep_published_documents();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0011_remove_company_api_key"),
        ("offerings", "0008_subscription_snapshots"),
    ]

    operations = [migrations.RunSQL(INSTALL, REMOVE)]
