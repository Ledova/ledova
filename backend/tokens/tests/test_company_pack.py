import ast
import csv
import hashlib
import importlib
import io
import json
import subprocess
import sys
import zipfile
from datetime import date, datetime
from datetime import timezone as utc_zone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib import admin
from django.db import DatabaseError, IntegrityError, connections
from django.db.models.expressions import RawSQL
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import Company, CompanyDocument, CompanyPack, CompanyRegistryCheck
from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from tokens.models import (
    FormerHolder,
    RegisterEntry,
    RegisterExport,
    ShareRegister,
    ShareToken,
    TokenDeployment,
)
from tokens.services.company_pack import COMPILER
from tokens.services.register import REGISTER_HEADERS, export_rows
from tokens.services.register_events import open_register, record_entry
from tokens.services.settlement_context import configured_domain
from tokens.tests.test_register_certificates import (
    entered,
    member_of,
    unused_address,
    wallet_of,
)
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_settlement_chain_agreement import factory_intent
from whitelist.models import WhitelistApproval, WhitelistEntry

CONSUMER = Path(__file__).with_name("company_pack_consumer.py")
ISOLATED = ("-I", "-S")
PRODUCED_AT = datetime(2026, 9, 24, 1, 2, 3, 456789, tzinfo=utc_zone.utc)
INSTRUCTION = "SYNTHETIC-PACK-INSTRUCTION-1"
RECIPIENT = "Synthetic Successor Registry Pty Ltd"
OPERATOR = "0x" + "0e" * 20
ROLES = ("founder", "holder", "allottee", "buyer")
HOLDING_ROLES = ("founder", "holder", "buyer")
INTERFACES = ("AtomicSwap", "ShareToken", "ShareTokenFactory", "WhitelistRegistry")
ALLOWED_IMPORTS = {"zipfile", "json", "csv", "hashlib", "io", "sys"}
LICENCE = (
    "The company, and a provider it names in writing, may use the records and the contract interface files in "
    "this pack to operate and move the company's own register and contracts."
)
PLATFORM_REFUSAL = "REFUSED django is importable, so this run could reach the platform: run it as python -I -S\n"


class Undone(Exception):
    pass


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def changes(*moves):
    return [{"member": str(member.pk), "shares": str(shares)} for member, shares in moves]


def pack_company(label):
    tenant = make_tenant(label)
    company, ordinary, preference = tenant.company, tenant.deployed_token, tenant.token
    TokenDeployment.objects.create(
        token_id=ordinary.pk,
        company_id=company.pk,
        intent={**factory_intent(ordinary, settings.BLOCKCHAIN_CHAIN_ID), "sender": OPERATOR},
    )
    addresses = {
        role: wallet_of(f"Synthetic {label} {role}", f"{index} Synthetic {label} Street, Sydney NSW 2000")
        for index, role in enumerate(ROLES, 1)
    }
    members = {role: member_of(company, address) for role, address in addresses.items()}
    registry = "0x" + sha256(label.encode())[:40]
    WhitelistApproval.objects.create(
        entry=WhitelistEntry.objects.get(wallet__address=addresses["founder"]),
        company=company,
        registry_address=registry,
        status="active",
    )
    CompanyRegistryCheck.objects.create(
        company=company,
        purpose="review",
        requested_name=company.name,
        requested_acn=company.acn,
        identity={},
        lifecycle_revision=0,
        status="passed",
        entity_name=f"{label} registered entity",
    )
    register = open_register(
        token_id=ordinary.pk,
        operation_id=uuid4(),
        changes=changes((members["founder"], 100), (members["holder"], 50)),
        effective_on=DAY,
        recorded_by=company.owner,
    ).register
    issue = entered(register, "issue", (members["allottee"], 25))
    record_entry(
        register_id=register.pk,
        operation_id=tenant.swap.pk,
        kind="transfer",
        changes=changes((members["founder"], -40), (members["buyer"], 40)),
        effective_on=DAY,
        recorded_by=company.owner,
    )
    entered(register, "correction", (members["allottee"], -25), corrects_id=issue.pk)
    former = unused_address()
    FormerHolder.objects.create(
        token=ordinary,
        wallet_address=former,
        ceased_on=date(2026, 3, 14),
        ceased_at_block=100,
        shares_at_cessation=10,
        name=f"Synthetic {label} former member",
        residential_address=f"9 Synthetic {label} Lane, Hobart TAS 7000",
    )
    second = open_register(
        token_id=preference.pk,
        operation_id=uuid4(),
        changes=changes((members["holder"], 10)),
        effective_on=DAY,
        recorded_by=company.owner,
    ).register
    entered(second, "transfer", (members["holder"], -4), (members["buyer"], 4))
    return SimpleNamespace(
        label=label,
        tenant=tenant,
        company=company,
        ordinary=ordinary,
        preference=preference,
        members=members,
        addresses=addresses,
        registry=registry,
        former=former,
        issue=issue,
    )


def records_of(fixture):
    registers = ShareRegister.objects.filter(token__company=fixture.company)
    return [
        str(value).lower()
        for value in (
            fixture.company.pk,
            fixture.company.acn,
            fixture.company.name,
            f"{fixture.label} registered entity",
            fixture.ordinary.pk,
            fixture.preference.pk,
            fixture.ordinary.contract_address,
            fixture.registry,
            fixture.former,
            fixture.tenant.swap.pk,
            *registers.values_list("uuid", flat=True),
            *RegisterEntry.objects.filter(register__in=registers).values_list("uuid", flat=True),
            *(member.pk for member in fixture.members.values()),
            *(fixture.addresses[role] for role in HOLDING_ROLES),
            *(f"Synthetic {fixture.label} {role}" for role in HOLDING_ROLES),
        )
    ]


def pack_staff(label):
    return grant(
        grant(staff_user(label), admin.site._registry[CompanyPack], "change"),
        admin.site._registry[CompanyDocument],
        "view",
    )


def page(company):
    return reverse("admin:companies_companypack_produce", args=[company.pk])


def files_of(content):
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        return {name: bundle.read(name) for name in bundle.namelist()}


def zipped(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)
    return buffer.getvalue()


def remanifested(files):
    manifest = json.loads(files["manifest.json"])
    manifest["files"] = [
        {"path": path, "size": len(content), "sha256": sha256(content)}
        for path, content in sorted(files.items())
        if path != "manifest.json"
    ]
    return {**files, "manifest.json": json.dumps(manifest).encode()}


def text_of(content):
    return "\n".join(file.decode() for file in files_of(content).values()).lower()


def consume(content, *flags):
    with TemporaryDirectory() as directory:
        Path(directory, "pack.zip").write_bytes(content)
        return subprocess.run(
            [sys.executable, *flags, str(CONSUMER), "pack.zip"],
            cwd=directory,
            env={},
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )


def imports_of(source):
    tree = ast.parse(source)
    imported = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    imported |= {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    dynamic = [
        (node.func.id, ast.literal_eval(node.args[0]))
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in ("__import__", "exec", "eval", "compile", "open")
    ]
    return imported, dynamic


class ProducesPacks:
    def produce(self, company=None, **fields):
        request = {"instruction": INSTRUCTION, "recipient": RECIPIENT, **fields}
        with patch("tokens.services.company_pack.timezone.now", return_value=PRODUCED_AT):
            return self.client.post(page(company or self.a.company), request)

    def pack(self, company=None, **fields):
        response = self.produce(company, **fields)
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/zip"))
        return b"".join(response.streaming_content)


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackConsumerTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.client.force_login(pack_staff("pack-consumer-staff"))

    def test_a_fresh_consumer_reads_the_pack_without_the_platform_and_prints_the_digest_that_was_recorded(self):
        content = self.pack()

        result = consume(content, *ISOLATED)

        digest = sha256(files_of(content)["manifest.json"])
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertEqual(
            result.stdout.splitlines(),
            ["DEP: 4 entries verified, 3 current members", "DRF: 2 entries verified, 2 current members", digest],
        )
        self.assertEqual(
            sorted(RegisterExport.objects.filter(kind="company_pack").values_list("digest", flat=True)),
            [digest, digest],
        )

    def test_the_consumer_refuses_to_run_where_django_can_be_imported(self):
        result = consume(self.pack(), "-I")

        self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", PLATFORM_REFUSAL))

    def test_the_consumer_imports_only_the_standard_library_modules_it_is_allowed(self):
        self.assertEqual(imports_of(CONSUMER.read_text()), (ALLOWED_IMPORTS, [("__import__", "django")]))
        self.assertEqual(
            imports_of("import socket\nfrom urllib import request\n__import__('http')\n"),
            ({"socket", "urllib"}, [("__import__", "http")]),
        )

    def test_each_tampering_fails_the_consumer_and_names_what_failed(self):
        files = files_of(self.pack())
        folder = f"classes/{self.a.ordinary.pk}"
        entries_path, csv_path = f"{folder}/entries.json", f"{folder}/register.csv"
        entries = json.loads(files[entries_path])

        def rewritten_entries(change):
            copy = json.loads(files[entries_path])
            change(copy)
            return remanifested({**files, entries_path: json.dumps(copy).encode()})

        def shares_changed(copy):
            copy[1]["changes"][0]["shares"] = "26"

        def link_broken(copy):
            fields = json.loads(copy[2]["preimage"])
            fields[10] = copy[2]["previous_hash"] = "f" * 64
            copy[2]["preimage"] = json.dumps(fields)
            copy[2]["entry_hash"] = sha256(copy[2]["preimage"].encode())

        def holding_changed():
            rows = list(csv.reader(io.StringIO(files[csv_path].decode(), newline="")))
            founder = next(row for row in rows if row and row[0] == str(self.a.members["founder"].pk))
            founder[REGISTER_HEADERS.index("Shares held")] = "61"
            sheet = io.StringIO()
            csv.writer(sheet).writerows(rows)
            return remanifested({**files, csv_path: sheet.getvalue().encode()})

        flipped = bytearray(files[csv_path])
        flipped[10] ^= 1
        for tampering, tampered, refusal in (
            ("a byte flipped in a file", {**files, csv_path: bytes(flipped)}, f"{csv_path}: SHA-256 does not match"),
            (
                "a file removed",
                {path: content for path, content in files.items() if path != f"{folder}/class.json"},
                f"{folder}/class.json: listed in the manifest and missing",
            ),
            ("a file added", {**files, "notes.txt": b"added"}, "notes.txt: present and not listed in the manifest"),
            (
                "one entry's shares changed",
                rewritten_entries(shares_changed),
                f"{entries_path} entry 2: the preimage does not match the entry's fields",
            ),
            (
                "one previous_hash broken",
                rewritten_entries(link_broken),
                f"{entries_path} entry 3: previous_hash does not link to entry 2",
            ),
            (
                "the last entry removed",
                rewritten_entries(lambda copy: copy.pop()),
                f"{entries_path}: ends at entry 3 with {entries[2]['entry_hash']}, and the manifest's head is entry 4 "
                f"with {entries[3]['entry_hash']}",
            ),
            (
                "one holding changed",
                holding_changed(),
                f"{csv_path}: the current members are not what {entries_path} replays to",
            ),
        ):
            with self.subTest(tampering=tampering):
                result = consume(zipped(tampered), *ISOLATED)

                self.assertEqual((result.returncode, result.stdout), (1, ""))
                self.assertTrue(result.stderr.startswith(f"REFUSED {refusal}"), result.stderr)
        untouched = consume(zipped(files), *ISOLATED)
        self.assertEqual((untouched.returncode, untouched.stderr), (0, ""))


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.staff = pack_staff("pack-staff")
        self.client.force_login(self.staff)

    def test_the_manifest_lists_every_other_file_and_names_the_company_request_and_register_heads(self):
        content = self.pack()

        files = files_of(content)
        manifest = json.loads(files["manifest.json"])
        ordinary, preference = str(self.a.ordinary.pk), str(self.a.preference.pk)
        listed = {
            "README.md",
            "company.json",
            "contracts/contracts.json",
            *(f"contracts/{name}.json" for name in INTERFACES),
            *(f"classes/{token}/{name}" for token in (ordinary, preference) for name in ("class.json", "entries.json")),
            *(f"classes/{token}/register.csv" for token in (ordinary, preference)),
        }
        self.assertEqual(set(files), listed | {"manifest.json"})
        self.assertEqual(
            manifest["files"],
            [{"path": path, "size": len(files[path]), "sha256": sha256(files[path])} for path in sorted(listed)],
        )
        heads = dict(ShareRegister.objects.filter(token__company=self.a.company).values_list("token_id", "head_hash"))
        self.assertEqual(
            {key: value for key, value in manifest.items() if key != "files"},
            {
                "format": "ledova-company-pack",
                "version": 1,
                "company": {"uuid": str(self.a.company.pk), "name": self.a.company.name, "acn": self.a.company.acn},
                "as_at": "2026-09-24T01:02:03.456789+00:00",
                "instruction": INSTRUCTION,
                "recipient": RECIPIENT,
                "registers": [
                    {"class": ordinary, "symbol": "DEP", "sequence": 4, "head_hash": heads[self.a.ordinary.pk]},
                    {"class": preference, "symbol": "DRF", "sequence": 2, "head_hash": heads[self.a.preference.pk]},
                ],
            },
        )
        self.assertEqual(
            [list(row) for row in csv.reader(io.StringIO(files[f"classes/{ordinary}/register.csv"].decode()))],
            [REGISTER_HEADERS, *export_rows(self.a.ordinary, self.staff)],
        )

    def test_each_entry_carries_its_fields_and_the_preimage_its_hash_was_computed_over(self):
        entries = json.loads(files_of(self.pack())[f"classes/{self.a.ordinary.pk}/entries.json"])

        stored = list(RegisterEntry.objects.filter(register__token=self.a.ordinary).order_by("sequence"))
        self.assertEqual(
            [{key: value for key, value in entry.items() if key != "preimage"} for entry in entries],
            [
                {
                    "sequence": entry.sequence,
                    "uuid": str(entry.pk),
                    "register": str(entry.register_id),
                    "operation_id": str(entry.operation_id),
                    "kind": entry.kind,
                    "effective_on": entry.effective_on.isoformat(),
                    "changes": entry.changes,
                    "corrects": None if entry.corrects_id is None else str(entry.corrects_id),
                    "previous_hash": entry.previous_hash,
                    "created_at": entry.created_at.astimezone(utc_zone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                    "entry_hash": entry.entry_hash,
                }
                for entry in stored
            ],
        )
        self.assertEqual(entries[2]["operation_id"], str(self.a.tenant.swap.pk))
        self.assertEqual(entries[3]["corrects"], str(self.a.issue.pk))
        self.assertEqual([sha256(entry["preimage"].encode()) for entry in entries], [e.entry_hash for e in stored])

    def test_the_preimage_function_returns_the_text_the_stored_hash_function_digests(self):
        entries = RegisterEntry.objects.filter(register__token__company=self.a.company).annotate(
            preimage=RawSQL("tokens_register_entry_preimage(tokens_registerentry)", []),
            recomputed=RawSQL("tokens_register_entry_hash(tokens_registerentry)", []),
        )

        self.assertEqual(len(entries), 6)
        for entry in entries:
            with self.subTest(sequence=entry.sequence):
                self.assertEqual(sha256(entry.preimage.encode()), entry.recomputed)
                self.assertEqual(entry.recomputed, entry.entry_hash)
                self.assertEqual(json.loads(entry.preimage)[:2], ["ledova-register-v1", str(entry.pk)])

    def test_the_company_file_carries_the_company_its_instructing_account_and_its_registry_checks(self):
        record = json.loads(files_of(self.pack())["company.json"])

        company = self.a.company
        self.assertEqual(
            {key: record[key] for key in ("uuid", "name", "acn", "type", "status", "owner_name")},
            {
                "uuid": str(company.pk),
                "name": company.name,
                "acn": company.acn,
                "type": "pty",
                "status": company.status,
                "owner_name": "pack-a owner",
            },
        )
        self.assertEqual(
            [(check["requested_name"], check["status"], check["entity_name"]) for check in record["registry_checks"]],
            [(company.name, "passed", "pack-a registered entity")],
        )

    def test_the_pack_carries_no_credential_or_contact_detail_of_the_platform_account(self):
        text = text_of(self.pack())

        company = Company.objects.get(pk=self.a.company.pk)
        self.assertIn(company.name.lower(), text)
        for secret in (company.api_key, self.a.tenant.user.email, self.a.tenant.account.account_number):
            with self.subTest(secret=secret):
                self.assertTrue(secret)
                self.assertNotIn(secret.lower(), text)

    def test_the_contract_files_are_the_committed_interfaces_with_the_addresses_owners_and_domains(self):
        files = files_of(self.pack())

        for name in INTERFACES:
            with self.subTest(interface=name):
                self.assertEqual(
                    files[f"contracts/{name}.json"],
                    (Path(settings.BASE_DIR) / "contracts" / f"{name}.json").read_bytes(),
                )
        contracts = json.loads(files["contracts/contracts.json"])
        self.assertEqual(
            contracts["registries"], [{"address": self.a.registry, "interface": "contracts/WhitelistRegistry.json"}]
        )
        self.assertEqual(
            contracts["classes"],
            [
                {
                    "class": str(self.a.ordinary.pk),
                    "symbol": "DEP",
                    "address": self.a.ordinary.contract_address,
                    "owner_at_deployment": OPERATOR,
                    "interface": "contracts/ShareToken.json",
                    "domain": {
                        "name": "Ledova Trading",
                        "version": "1",
                        "chainId": settings.BLOCKCHAIN_CHAIN_ID,
                        "verifyingContract": self.a.ordinary.contract_address,
                    },
                },
                {
                    "class": str(self.a.preference.pk),
                    "symbol": "DRF",
                    "address": None,
                    "owner_at_deployment": None,
                    "interface": "contracts/ShareToken.json",
                    "domain": None,
                },
            ],
        )

    def test_the_compiler_settings_are_the_ones_the_contracts_are_built_with(self):
        contracts = Path(settings.BASE_DIR).parent / "contracts"
        config = (contracts / "hardhat.config.ts").read_text()

        for setting in (
            f'version: "{COMPILER["solidity"]}"',
            f'evmVersion: "{COMPILER["evm_version"]}"',
            f"runs: {COMPILER['optimizer_runs']}",
            f"viaIR: {str(COMPILER['via_ir']).lower()}",
        ):
            with self.subTest(setting=setting):
                self.assertIn(setting, config)
        self.assertEqual(
            json.loads((contracts / "package.json").read_text())["devDependencies"]["@openzeppelin/contracts"],
            COMPILER["openzeppelin"],
        )

    def test_the_settlement_domain_is_the_one_settlements_are_signed_under(self):
        with override_settings(ATOMIC_SWAP_ADDRESS="0x" + "9d" * 20):
            configured = json.loads(files_of(self.pack())["contracts/contracts.json"])["swap"]
            self.assertEqual(configured["domain"], configured_domain())
        with override_settings(ATOMIC_SWAP_ADDRESS=""):
            unconfigured = json.loads(files_of(self.pack())["contracts/contracts.json"])["swap"]
        self.assertEqual((unconfigured["address"], unconfigured["domain"]), (None, None))

    def test_the_readme_names_the_request_each_head_and_owner_and_grants_the_owners_licence_verbatim(self):
        readme = files_of(self.pack())["README.md"].decode()

        self.assertIn(LICENCE, readme)
        self.assertIn(f'referenced as "{INSTRUCTION}", for {RECIPIENT}.', readme)
        self.assertIn("as at 2026-09-24T01:02:03.456789+00:00 (UTC)", readme)
        for register in ShareRegister.objects.filter(token__company=self.a.company):
            with self.subTest(register=register.token.symbol):
                self.assertIn(f"| {register.sequence} | `{register.head_hash}` |", readme)
        self.assertIn(f"| Share class DEP | `{self.a.ordinary.contract_address}` | `{OPERATOR}` |", readme)
        self.assertIn(f"| The company's registry | `{self.a.registry}` |", readme)
        self.assertNotIn("registryOf(", readme)

    def test_the_same_records_give_the_same_pack_and_a_different_request_a_different_digest(self):
        first, second = self.pack(), self.pack()
        other = self.pack(recipient="Another Synthetic Recipient")

        self.assertEqual(first, second)
        self.assertEqual(sha256(files_of(first)["manifest.json"]), sha256(files_of(second)["manifest.json"]))
        self.assertNotEqual(sha256(files_of(other)["manifest.json"]), sha256(files_of(first)["manifest.json"]))
        with zipfile.ZipFile(io.BytesIO(first)) as bundle:
            members = bundle.infolist()
        self.assertEqual([member.filename for member in members], sorted(member.filename for member in members))
        self.assertEqual({member.date_time for member in members}, {(1980, 1, 1, 0, 0, 0)})

    def test_a_pack_is_recorded_once_for_each_share_class_with_the_manifest_digest_and_the_request(self):
        response = self.produce()
        content = b"".join(response.streaming_content)

        self.assertEqual(
            response["Content-Disposition"],
            f'attachment; filename="company-pack-{self.a.company.acn}-20260924T010203Z.zip"',
        )
        digest = sha256(files_of(content)["manifest.json"])
        self.assertEqual(
            list(
                RegisterExport.objects.order_by("token__symbol").values_list(
                    "kind",
                    "token_id",
                    "requested_by_id",
                    "register_sequence",
                    "member_rows",
                    "former_rows",
                    "digest",
                    "instruction",
                    "recipient",
                    "requested_on",
                    "late",
                    "period_from",
                )
            ),
            [
                (
                    "company_pack",
                    self.a.ordinary.pk,
                    self.staff.pk,
                    4,
                    3,
                    1,
                    digest,
                    INSTRUCTION,
                    RECIPIENT,
                    None,
                    None,
                    None,
                ),
                (
                    "company_pack",
                    self.a.preference.pk,
                    self.staff.pk,
                    2,
                    2,
                    0,
                    digest,
                    INSTRUCTION,
                    RECIPIENT,
                    None,
                    None,
                    None,
                ),
            ],
        )

    def test_a_share_class_whose_register_is_not_opened_is_carried_with_an_empty_history(self):
        unopened = ShareToken.objects.create(
            company=self.a.company, name="Synthetic unopened shares", symbol="NEW", total_supply="500"
        )

        content = self.pack()

        files = files_of(content)
        folder = f"classes/{unopened.pk}"
        self.assertNotIn(f"{folder}/register.csv", files)
        self.assertEqual(json.loads(files[f"{folder}/entries.json"]), [])
        self.assertIsNone(json.loads(files[f"{folder}/class.json"])["register"])
        self.assertIn(
            {"class": str(unopened.pk), "symbol": "NEW", "sequence": 0, "head_hash": "0" * 64},
            json.loads(files["manifest.json"])["registers"],
        )
        self.assertIn("NEW: 0 entries verified, 0 current members", consume(content, *ISOLATED).stdout.splitlines())
        self.assertEqual(
            list(
                RegisterExport.objects.filter(token=unopened).values_list(
                    "register_sequence", "member_rows", "former_rows"
                )
            ),
            [(0, 0, 0)],
        )

    def test_a_refused_request_records_nothing_and_says_why(self):
        empty = Company.objects.create(owner=self.a.company.owner, name="Synthetic Empty Pty Ltd", acn="999999999")

        for request, company, refusal in (
            ({}, empty, "This company has no share classes, so there is no register to put in a pack."),
            ({"instruction": " \t"}, self.a.company, "This field is required."),
            ({"recipient": ""}, self.a.company, "This field is required."),
        ):
            with self.subTest(request=request, company=company.name):
                response = self.produce(company, **request)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
                self.assertContains(response, refusal)
        self.assertFalse(RegisterExport.objects.exists())

    def test_an_entry_that_no_longer_matches_its_hash_refuses_the_pack_and_records_nothing(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("ALTER TABLE tokens_registerentry DISABLE TRIGGER USER")
            cursor.execute(
                "UPDATE tokens_registerentry SET effective_on = '2020-01-01' WHERE uuid = %s", [self.a.issue.pk]
            )
            cursor.execute("ALTER TABLE tokens_registerentry ENABLE TRIGGER USER")

        response = self.produce()

        self.assertEqual(response.status_code, 200)
        self.assertContains(
            response,
            "Entry 2 of DEP&#x27;s register does not match its hash, so no pack was produced. Run the register "
            "integrity verifier for this share class before producing a pack. Nothing was recorded.",
        )
        self.assertFalse(RegisterExport.objects.exists())

    def test_a_failure_while_writing_the_archive_records_nothing(self):
        with (
            patch("tokens.services.company_pack.zipfile.ZipFile.writestr", side_effect=OSError("synthetic failure")),
            self.assertRaisesMessage(OSError, "synthetic failure"),
        ):
            self.produce()

        self.assertFalse(RegisterExport.objects.exists())

    def test_staff_need_both_the_pack_permission_and_the_company_document_permission(self):
        pack, documents = admin.site._registry[CompanyPack], admin.site._registry[CompanyDocument]
        for label, user in (
            ("neither", staff_user("pack-neither")),
            ("pack only", grant(staff_user("pack-only"), pack, "change")),
            ("documents only", grant(staff_user("pack-documents-only"), documents, "view")),
            ("pack view and documents", grant(grant(staff_user("pack-viewer"), pack, "view"), documents, "view")),
        ):
            with self.subTest(staff=label):
                self.client.force_login(user)

                self.assertEqual(self.client.get(page(self.a.company)).status_code, 403)
                self.assertEqual(self.produce().status_code, 403)
        self.assertFalse(RegisterExport.objects.exists())

        self.client.force_login(self.staff)

        self.assertContains(self.client.get(reverse("admin:companies_companypack_changelist")), page(self.a.company))
        self.assertContains(self.client.get(page(self.a.company)), "Produce and download")
        self.assertEqual(self.produce().status_code, 200)
        self.assertEqual(RegisterExport.objects.count(), 2)

    def test_another_companys_pack_carries_none_of_this_companys_records(self):
        b = pack_company("pack-b")
        records = records_of(self.a)

        a_text, b_text = text_of(self.pack(self.a.company)), text_of(self.pack(b.company))

        self.assertEqual([record for record in records if record not in a_text], [])
        self.assertEqual([record for record in records if record in b_text], [])
        self.assertEqual([record for record in records_of(b) if record in a_text], [])

    def test_the_database_holds_a_company_pack_record_to_its_digest_instruction_and_recipient(self):
        def insert(**columns):
            row = {
                "uuid": uuid4(),
                "created_at": timezone.now(),
                "updated_at": timezone.now(),
                "token_id": self.a.ordinary.pk,
                "requested_by_id": self.staff.pk,
                "kind": "company_pack",
                "register_sequence": 4,
                "member_rows": 3,
                "former_rows": 1,
                "digest": "a" * 64,
                "instruction": INSTRUCTION,
                "recipient": RECIPIENT,
                **columns,
            }
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO tokens_registerexport ({', '.join(row)}) VALUES ({', '.join(['%s'] * len(row))})",
                    list(row.values()),
                )

        insert()
        insert(register_sequence=0, member_rows=0, former_rows=0)
        for field, value, constraint in (
            ("digest", "", "register_export_company_pack_shape"),
            ("digest", "A" * 64, "register_export_company_pack_shape"),
            ("digest", "a" * 63, "register_export_company_pack_shape"),
            ("instruction", "", "register_export_company_pack_shape"),
            ("instruction", " \t", "register_export_company_pack_shape"),
            ("recipient", "", "register_export_company_pack_shape"),
            ("recipient", " ", "register_export_company_pack_shape"),
            ("requested_on", DAY, "register_export_company_pack_shape"),
            ("late", False, "register_export_company_pack_shape"),
            ("period_from", DAY, "register_export_period_only_for_notice_figures"),
        ):
            with (
                self.subTest(field=field, value=value),
                self.assertRaisesMessage(IntegrityError, constraint),
                atomic(),
            ):
                insert(**{field: value})
        self.assertEqual(RegisterExport.objects.filter(kind="company_pack").count(), 2)

    def test_downgrade_drops_the_preimage_function_only_while_no_company_pack_is_recorded(self):
        migration = importlib.import_module("tokens.migrations.0080_company_pack")

        with self.assertRaises(Undone), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_preimage(None, editor)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT to_regprocedure('tokens_register_entry_preimage(tokens_registerentry)')")
                self.assertIsNone(cursor.fetchone()[0])
            raise Undone
        self.pack()

        with self.assertRaisesRegex(RuntimeError, "Retain company pack records"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_preimage(None, editor)

        self.assertEqual(RegisterExport.objects.filter(kind="company_pack").count(), 2)


class ScopedCompanyPackTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, _, _, self.opening = register_fixture()

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_pack_page_reads_one_snapshot_and_records_on_the_operator_connection(self):
        with use_operator():
            member = member_of(self.company, wallet_of("Synthetic Scoped Pack Member", "6 Synthetic Street"))
            entered(self.opening.register, "issue", (member, 5))
            staff = pack_staff("scoped-company-pack")
            self.client.force_login(staff)

        response = self.client.post(page(self.company), {"instruction": INSTRUCTION, "recipient": RECIPIENT})

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/zip"))
        digest = sha256(files_of(b"".join(response.streaming_content))["manifest.json"])
        with use_operator():
            record = RegisterExport.objects.get(kind="company_pack")
        self.assertEqual(
            (record.token_id, record.requested_by_id, record.digest, record.register_sequence, record.member_rows),
            (self.token.pk, staff.pk, digest, 2, 2),
        )
        self.the_principal_the_middleware_would_set(self.owner)
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            RegisterExport.objects.filter(pk=record.pk).exists()
