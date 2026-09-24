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
