from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function

FUNCTIONS = {
    "database_allotment_guards.sql": (
        "tokens_guard_register_member_particulars",
        "tokens_register_particulars_snapshot",
        "tokens_register_allotment_decision_digest",
        "tokens_register_grant_decision_digest",
    ),
    "database_member_guards.sql": ("tokens_member_identity",),
    "database_mirror_guards.sql": ("tokens_mirror_award_identities_valid",),
    "database_award_guards.sql": ("tokens_guard_award_member", "tokens_check_award_person_record"),
}

PERSON_RECORDS = """
    INSERT INTO tokens_registermember (uuid, created_at, updated_at, company_id)
    SELECT DISTINCT ON (award.member) award.member, now(), now(), award.company_id
        FROM tokens_registeraward award
        WHERE award.new_member
            AND NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = award.member)
        ORDER BY award.member, award.created_at, award.uuid;
    INSERT INTO tokens_registermemberparticulars
        (uuid, created_at, updated_at, member_id, name, residential_address, as_at, source_award_id)
    SELECT gen_random_uuid(), now(), now(), award.member, award.name, award.residential_address,
            (award.created_at AT TIME ZONE 'UTC')::date, award.uuid
        FROM (SELECT DISTINCT ON (member) * FROM tokens_registeraward WHERE new_member
            ORDER BY member, created_at, uuid) award
        JOIN tokens_registermember member ON member.uuid = award.member AND member.company_id = award.company_id
        WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars held WHERE held.member_id = award.member);
"""


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator, migrate = cursor.fetchone()
        for filename, names in FUNCTIONS.items():
            source = Path(__file__).with_name(filename).read_text()
            for name in names:
                cursor.execute(
                    _function(source, name).replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate)
                )
        cursor.execute("DROP TRIGGER IF EXISTS tokens_award_member ON tokens_registermember")
        cursor.execute(
            "CREATE TRIGGER tokens_award_member BEFORE INSERT ON tokens_registermember "
            "FOR EACH ROW EXECUTE FUNCTION tokens_guard_award_member()"
        )
        cursor.execute("DROP TRIGGER IF EXISTS tokens_award_person_record ON tokens_registeraward")
        cursor.execute(
            "CREATE CONSTRAINT TRIGGER tokens_award_person_record AFTER INSERT ON tokens_registeraward "
            "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_award_person_record()"
        )
        cursor.execute(PERSON_RECORDS)
