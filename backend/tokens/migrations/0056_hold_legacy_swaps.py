from django.db import migrations

FORWARD = """
CREATE FUNCTION hold_legacy_swap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.settlement_protocol_version = 0 THEN
        RAISE EXCEPTION 'Legacy swap history is held for operator attribution' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER hold_legacy_swap BEFORE UPDATE OR DELETE ON tokens_swaporder
FOR EACH ROW EXECUTE FUNCTION hold_legacy_swap();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_swaporder WHERE settlement_protocol_version = 0) THEN
        RAISE EXCEPTION 'Cannot remove the hold on retained legacy swap history';
    END IF;
END $$;
DROP TRIGGER hold_legacy_swap ON tokens_swaporder;
DROP FUNCTION hold_legacy_swap();
"""


class Migration(migrations.Migration):
    dependencies = [("tokens", "0055_order_submission_settlement_refusal")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
