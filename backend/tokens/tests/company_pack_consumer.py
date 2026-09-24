import csv
import hashlib
import io
import json
import sys
import zipfile

FORMAT = "ledova-company-pack"
VERSION = 1
MANIFEST = "manifest.json"
RECIPE = "ledova-register-v1"
EMPTY_HEAD = "0" * 64
PREIMAGE_LENGTH = 12
RECORDED_BY = 9
HEXADECIMAL = set("0123456789abcdef")
UNSIGNED = ("preparing", "failed")


class Refused(Exception):
    pass


def refuse_the_platform():
    try:
        __import__("django")
    except ImportError:
        return
    raise Refused("django is importable, so this run could reach the platform: run it as python -I -S")


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def read_manifest(bundle):
    names = set(bundle.namelist())
    if MANIFEST not in names:
        raise Refused(f"{MANIFEST}: missing")
    raw = bundle.read(MANIFEST)
    manifest = json.loads(raw)
    if (manifest.get("format"), manifest.get("version")) != (FORMAT, VERSION):
        raise Refused(f"{MANIFEST}: not {FORMAT} version {VERSION}")
    listed = {item["path"]: item for item in manifest["files"]}
    unlisted = sorted(names - set(listed) - {MANIFEST})
    if unlisted:
        raise Refused(f"{unlisted[0]}: present and not listed in the manifest")
    files = {}
    for path, item in sorted(listed.items()):
        if path not in names:
            raise Refused(f"{path}: listed in the manifest and missing")
        try:
            content = bundle.read(path)
        except zipfile.BadZipFile:
            raise Refused(f"{path}: the archive's copy is damaged") from None
        if len(content) != item["size"]:
            raise Refused(f"{path}: {len(content)} bytes, and the manifest says {item['size']}")
        if sha256(content) != item["sha256"]:
            raise Refused(f"{path}: SHA-256 does not match the manifest")
        files[path] = content
    return manifest, raw, files


def listed_file(files, path):
    if path not in files:
        raise Refused(f"{path}: not in the manifest")
    return files[path]


def check_chain(path, entries, register):
    previous = EMPTY_HEAD
    for number, entry in enumerate(entries, 1):
        where = f"{path} entry {number}"
        if entry["sequence"] != number:
            raise Refused(f"{where}: numbered {entry['sequence']}")
        if sha256(entry["preimage"].encode("utf-8")) != entry["entry_hash"]:
            raise Refused(f"{where}: entry_hash is not the SHA-256 of its preimage")
        fields = json.loads(entry["preimage"])
        exported = [
            RECIPE,
            entry["uuid"],
            entry["register"],
            entry["operation_id"],
            entry["sequence"],
            entry["kind"],
            entry["effective_on"],
            entry["changes"],
            entry["corrects"],
            entry["previous_hash"],
            entry["created_at"],
        ]
        if (
            not isinstance(fields, list)
            or len(fields) != PREIMAGE_LENGTH
            or fields[:RECORDED_BY] + fields[RECORDED_BY + 1 :] != exported
        ):
            raise Refused(f"{where}: the preimage does not match the entry's fields")
        if entry["previous_hash"] != previous:
            raise Refused(f"{where}: previous_hash does not link to entry {number - 1}")
        previous = entry["entry_hash"]
    if (len(entries), previous) != (register["sequence"], register["head_hash"]):
        raise Refused(
            f"{path}: ends at entry {len(entries)} with {previous}, and the manifest's head is entry "
            f"{register['sequence']} with {register['head_hash']}"
        )


def hexadecimal(value, digits):
    return (
        isinstance(value, str) and len(value) == digits + 2 and value.startswith("0x") and set(value[2:]) <= HEXADECIMAL
    )


def whole(value, least):
    return isinstance(value, int) and not isinstance(value, bool) and value >= least


def check_opening(where, record, entry):
    boundary = record["boundary"]
    if boundary is None:
        raise Refused(f"{where}: an applied opening carries the boundary it was reviewed against")
    member_of = {link["address"].lower(): link["member"] for link in record["mapping"]}
    held = {}
    for holding in boundary["holdings"]:
        member = member_of.get(holding["address"].lower())
        if member is None:
            raise Refused(
                f"{where}: wallet {holding['address']} holds shares at the boundary and is mapped to no member"
            )
        held[member] = held.get(member, 0) + int(holding["shares"])
    changes = sorted((change["member"], int(change["shares"])) for change in entry["changes"])
    if changes != sorted(held.items()) or entry["effective_on"] != boundary["block"]["date"]:
        raise Refused(f"{where}: entry {entry['uuid']} is not the boundary's holdings on the boundary's date")


def check_authority(path, authority, entries):
    by_uuid = {entry["uuid"]: entry for entry in entries}
    for section, kind in (("openings", "opening"), ("corrections", "correction")):
        for number, record in enumerate(authority[section], 1):
            where = f"{path} {section} {number}"
            if (record["status"] == "applied") != (record["entry"] is not None):
                raise Refused(f"{where}: an applied record names its entry, and no other record does")
            if record["entry"] is None:
                continue
            entry = by_uuid.get(record["entry"])
            if (
                entry is None
                or (entry["kind"], entry["operation_id"]) != (kind, record["uuid"])
                or (kind == "correction" and entry["corrects"] != record["corrects"])
            ):
                raise Refused(f"{where}: entry {record['entry']} is not its {kind} in entries.json")
            if kind == "opening":
                check_opening(where, record, entry)


def check_operations(path, chain):
    operations = {}
    for number, operation in enumerate(chain["operations"], 1):
        where = f"{path} operation {number}"
        hashes = []
        for attempt in operation["attempts"]:
            if not (
                hexadecimal(attempt["tx_hash"], 64)
                and hexadecimal(attempt["signer"], 40)
                and whole(attempt["nonce"], 0)
                and whole(attempt["chain_id"], 1)
            ):
                raise Refused(f"{where}: attempt {attempt['tx_hash']} has no well-formed hash, signer, nonce and chain")
            hashes.append(attempt["tx_hash"])
        current = operation["current_attempt"]
        if (current is None) != (operation["status"] in UNSIGNED) or (current is not None and current not in hashes):
            raise Refused(f"{where}: its current attempt {current} is not one of its attempts")
        receipt = operation["receipt"]
        if receipt is not None and not hexadecimal(receipt["block_hash"], 64):
            raise Refused(f"{where}: its receipt has no well-formed block hash")
        operations[operation["key"]] = (operation["purpose"], operation["record"])
    return operations


def records_naming_operations(share_class, chain, issues, settlements):
    named = [("pause", pause["uuid"], pause["operation"]) for pause in share_class["pauses"]]
    named += [
        ("capital_increase", increase["execution"]["uuid"], increase["execution"]["operation"])
        for increase in share_class["cap_increases"]
        if increase["execution"] is not None
    ]
    named += [
        ("issuance", issue["execution"]["uuid"], issue["execution"]["operation"])
        for issue in issues["issues"]
        if issue["execution"] is not None
    ]
    named += [("settlement", settlement["uuid"], settlement["operation"]) for settlement in settlements]
    deployment = chain["deployment"]
    if deployment is not None:
        named += [
            ("deployment", deployment["uuid"], deployment["operation"]),
            ("swap_approval", deployment["uuid"], deployment["swap_approval"]["operation"]),
        ]
    return [(purpose, record, key) for purpose, record, key in named if key is not None]


def check_links(path, operations, named):
    for purpose, record, key in named:
        if operations.get(key) != (purpose, record):
            raise Refused(f"{path}: the {purpose} {record} names operation {key}, which is not listed for it")
    unnamed = sorted(set(operations) - {key for _, _, key in named})
    if unnamed:
        raise Refused(f"{path}: operation {unnamed[0]} is named by no record")


def check_settlements(path, settlements, entries):
    by_uuid = {entry["uuid"]: entry for entry in entries}
    for number, settlement in enumerate(settlements, 1):
        where = f"{path} settlement {number}"
        if settlement["transaction"] is None:
            if settlement["entry"] is not None:
                raise Refused(f"{where}: it names a register entry but no transaction")
            continue
        if not hexadecimal(settlement["transaction"], 64):
            raise Refused(f"{where}: its transaction is not a well-formed hash")
        if settlement["entry"] is None:
            continue
        entry = by_uuid.get(settlement["entry"])
        if entry is None or (entry["kind"], entry["operation_id"]) != ("transfer", settlement["uuid"]):
            raise Refused(f"{where}: entry {settlement['entry']} is not its transfer in entries.json")


def replay(entries):
    holdings = {}
    for entry in entries:
        for change in entry["changes"]:
            holdings[change["member"]] = holdings.get(change["member"], 0) + int(change["shares"])
    return {member: shares for member, shares in holdings.items() if shares}


def current_members(path, content):
    header, *rows = csv.reader(io.StringIO(content.decode("utf-8"), newline=""))
    if "Member ID" not in header or "Shares held" not in header:
        raise Refused(f"{path}: the current members have no Member ID or Shares held column")
    member, shares = header.index("Member ID"), header.index("Shares held")
    listed = {}
    for row in rows:
        if not row:
            break
        listed[row[member]] = int(row[shares])
    return listed


def check(path):
    refuse_the_platform()
    with zipfile.ZipFile(path) as bundle:
        manifest, raw, files = read_manifest(bundle)
    lines = []
    for register in manifest["registers"]:
        folder = f"classes/{register['class']}"
        entries_path = f"{folder}/entries.json"
        entries = json.loads(listed_file(files, entries_path))
        check_chain(entries_path, entries, register)
        authority_path = f"{folder}/authority.json"
        check_authority(authority_path, json.loads(listed_file(files, authority_path)), entries)
        chain_path, settlements_path = f"{folder}/chain.json", f"{folder}/settlements.json"
        chain = json.loads(listed_file(files, chain_path))
        settlements = json.loads(listed_file(files, settlements_path))
        check_settlements(settlements_path, settlements, entries)
        named = records_naming_operations(
            json.loads(listed_file(files, f"{folder}/class.json")),
            chain,
            json.loads(listed_file(files, f"{folder}/issues.json")),
            settlements,
        )
        check_links(chain_path, check_operations(chain_path, chain), named)
        holdings = replay(entries)
        if register["sequence"]:
            csv_path = f"{folder}/register.csv"
            listed = current_members(csv_path, listed_file(files, csv_path))
            if listed != holdings:
                raise Refused(f"{csv_path}: the current members are not what {entries_path} replays to")
        lines.append(f"{register['symbol']}: {len(entries)} entries verified, {len(holdings)} current members")
    return lines, sha256(raw)


def main(arguments):
    if len(arguments) != 2:
        print("usage: python -I -S company_pack_consumer.py PACK.zip", file=sys.stderr)
        return 2
    try:
        lines, digest = check(arguments[1])
    except Refused as refusal:
        print(f"REFUSED {refusal}", file=sys.stderr)
        return 1
    for line in lines:
        print(line)
    print(digest)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
