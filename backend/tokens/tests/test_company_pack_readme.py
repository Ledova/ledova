import re
from pathlib import Path

from django.template import engines
from django.template.base import TextNode, VariableNode
from django.template.defaulttags import (
    AutoEscapeControlNode,
    ForNode,
    IfNode,
    LoadNode,
    WithNode,
)
from django.template.loader import get_template
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils.safestring import SafeString

from companies.models import Company, CompanyDocument
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.tests.fixtures import published
from tokens.models import FormerHolder, ShareToken
from tokens.templatetags.company_pack_text import md
from tokens.tests.test_company_pack import (
    ProducesPacks,
    files_of,
    pack_company,
    pack_staff,
)
from tokens.tests.test_company_pack_publications import publishing_company, upload

README = "tokens/company_pack_readme.md"
OURS = {
    "as_at",
    "classes[].token.pk",
    "classes[].token.status",
    "classes[].sequence",
    "classes[].head_hash",
    "contracts.chain_id",
    "contracts.classes[].address",
    "contracts.classes[].owner_at_deployment",
    "contracts.registries[].address",
    "contracts.factory.address",
    "contracts.swap.address",
    "approvals[].registry",
    "approvals[].status",
    "approvals[].expires_at|date",
    "classes[].waiting|length",
    "classes[].former[].ceased_on|date",
    "classes[].former[].retain_until|date",
    "classes[].due[].sequence",
    "classes[].due[].kind",
    "classes[].due[].output",
    "classes[].due[].due_on|date",
    "classes[].awaiting_allotment|length",
    "classes[].awaiting_allotment|length|pluralize",
    "contracts.registries[].owner",
    "contracts.classes[].approved_on",
    "unresolved[].purpose",
    "unresolved[].record",
    "unresolved[].status",
    "documents[].path",
    "documents[].type",
    "copies",
    "copies|pluralize",
    "publications[].publication.pk",
    "publications[].publication.kind",
    "publications[].publication.record_date|date",
    "publications[].events",
    "publications[].head_hash",
}
HOSTILE = "<script>x</script> a|b\n# heading [link](http://x) **bold** &lt;"
INERT = r"\<script\>x\</script\> a\|b \# heading \[link\](http://x) \*\*bold\*\* \&lt;"
HOSTILE_SYMBOL = "a|b\n# <i>"
INERT_SYMBOL = r"a\|b \# \<i\>"
HEADING = re.compile(r" {0,3}(?:(?:[-+*]|\d{1,9}[.)]) +)*#")


def resolved(path, scope):
    head, dot, rest = path.partition(".")
    return scope.get(head, head) + dot + rest


def written(expression, scope):
    return resolved(str(expression.var), scope) + "".join(
        f"|{function.__name__}" + "".join(f":{resolved(str(value), scope)}" for lookup, value in arguments if lookup)
        for function, arguments in expression.filters
    )


def interpolations(nodes, scope):
    for node in nodes:
        if isinstance(node, VariableNode):
            expression = node.filter_expression
            yield written(expression, scope), [function.__name__ for function, _ in expression.filters]
        elif isinstance(node, ForNode):
            each = written(node.sequence, scope) + "[]"
            yield from interpolations(node.nodelist_loop, {**scope, **dict.fromkeys(node.loopvars, each)})
            yield from interpolations(node.nodelist_empty, scope)
        elif isinstance(node, IfNode):
            for _, branch in node.conditions_nodelists:
                yield from interpolations(branch, scope)
        elif isinstance(node, WithNode):
            aliases = {name: written(value, scope) for name, value in node.extra_context.items()}
            yield from interpolations(node.nodelist, {**scope, **aliases})
        elif isinstance(node, AutoEscapeControlNode):
            yield from interpolations(node.nodelist, scope)
        elif not isinstance(node, (TextNode, LoadNode)):
            yield type(node).__name__, None


def unfiltered(nodes):
    return [
        path
        for path, filters in interpolations(nodes, {})
        if filters is None or (path not in OURS and filters[-1:] != ["md"])
    ]


def unescaped(text):
    return re.sub(r"\\.", "", text)


def headings(readme):
    return [line for line in readme.splitlines() if HEADING.match(line)]


def tables(readme):
    found, table = [], []
    for line in [*readme.splitlines(), ""]:
        if line.lstrip().startswith("|"):
            table.append(line)
        elif table:
            found.append(table)
            table = []
    return found


def ragged(readme):
    return [table for table in tables(readme) if len({unescaped(row).count("|") for row in table}) != 1]


class CompanyPackReadmeTemplateTest(SimpleTestCase):
    def test_every_interpolation_is_escaped_or_is_a_value_ledova_produces(self):
        nodes = get_template(README).template.nodelist

        self.assertEqual(unfiltered(nodes), [])

    def test_the_guard_finds_an_unescaped_value_in_a_loop_an_alias_a_filter_or_a_tag_it_does_not_read(self):
        source = Path(get_template(README).origin.name).read_text()
        for change, found in (
            (("{{ share_class.token.name|md }}", "{{ share_class.token.name }}"), ["classes[].token.name"]),
            (("{% endautoescape %}", "{% firstof recipient %}{% endautoescape %}"), ["FirstOfNode"]),
            (("{{ as_at }}", "{{ as_at|default:recipient }}"), ["as_at|default:recipient"]),
            (
                ("{% endautoescape %}", "{% with alias=company.name %}{{ alias }}{% endwith %}{% endautoescape %}"),
                ["company.name"],
            ),
        ):
            with self.subTest(found=found):
                self.assertEqual(source.count(change[0]), 1)
                nodes = engines["django"].from_string(source.replace(*change)).template.nodelist

                self.assertEqual(unfiltered(nodes), found)

    def test_md_keeps_ordinary_text_and_escapes_what_markdown_or_html_would_read(self):
        for value, text in (
            ("O'Brien-Smith (Holdings) Pty. Ltd, No. 2", "O'Brien-Smith (Holdings) Pty. Ltd, No. 2"),
            ("123-456-789", "123-456-789"),
            ("a\r\nb\tc\x0bd\x85e\u2028f", "a  b c d e f"),
            ("  - listed  ", r"\- listed"),
            ("+ more", r"\+ more"),
            ("12. ordered", r"12\. ordered"),
            ("3) ordered", r"3\) ordered"),
            ("\\`*_{}[]<>#|&!~", r"\\\`\*\_\{\}\[\]\<\>\#\|\&\!\~"),
            (HOSTILE, INERT),
            (42, "42"),
        ):
            with self.subTest(value=value):
                self.assertEqual(md(value), text)
                self.assertIsInstance(md(value), SafeString)


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackReadmeTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-r")
        self.client.force_login(pack_staff("pack-readme-staff"))

    def readme(self, **fields):
        return files_of(self.pack(**fields))["README.md"].decode()

    def test_text_the_company_or_staff_supplied_reads_as_text_and_leaves_the_readme_its_shape(self):
        plain = self.readme()
        Company.objects.filter(pk=self.a.company.pk).update(name=f"Synthetic {HOSTILE} Pty Ltd")
        ShareToken.objects.filter(pk=self.a.ordinary.pk).update(
            name=f"Synthetic {HOSTILE} shares", symbol=HOSTILE_SYMBOL
        )
        FormerHolder.objects.filter(token=self.a.ordinary).update(name=f"Synthetic {HOSTILE} former member")
        CompanyDocument.objects.filter(company=self.a.company, name=f"Synthetic {self.a.label} constitution").update(
            name=f"Synthetic {HOSTILE} constitution", external_url=f"https://docs.example.test/{HOSTILE}"
        )

        hostile = self.readme(instruction=f"REF {HOSTILE}", recipient=f"Recipient {HOSTILE}")

        self.assertIn("<script", HOSTILE)
        self.assertNotIn("<script", unescaped(hostile))
        self.assertEqual(len(hostile.splitlines()), len(plain.splitlines()))
        self.assertEqual(headings(hostile)[1:], headings(plain)[1:])
        self.assertEqual(headings(hostile)[0], f"# Company pack: Synthetic {INERT} Pty Ltd (ACN {self.a.company.acn})")
        self.assertEqual(len(tables(hostile)), len(tables(plain)))
        self.assertEqual(ragged(hostile), [])
        for inert in (
            f"records Ledova kept for Synthetic {INERT} Pty Ltd as at",
            f'referenced as "REF {INERT}", for Recipient {INERT}.',
            f"| {INERT_SYMBOL} | Synthetic {INERT} shares |",
            f"| Share class {INERT_SYMBOL} |",
            f"| {INERT_SYMBOL} | Synthetic {INERT} former member |",
            f"- {INERT_SYMBOL}: ",
            f"| not carried: https://docs.example.test/{INERT} | constitution | Synthetic {INERT} constitution |",
        ):
            with self.subTest(inert=inert):
                self.assertIn(inert, hostile)


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackPublicationReadmeTest(ProducesPacks, StubUploadDependencies, TestCase):
    def setUp(self):
        self.a = publishing_company("pub-r", 861_000_900, 700)
        self.client.force_login(pack_staff("pack-readme-publications-staff"))

    def test_a_publication_title_and_the_class_symbol_it_names_read_as_text(self):
        ShareToken.objects.filter(pk=self.a.token.pk).update(symbol=HOSTILE_SYMBOL)
        self.a.token.refresh_from_db()
        publication = published(
            self.a, title=f"Synthetic {HOSTILE} statement", upload=upload(self.a, "statement.pdf", 1)
        )

        readme = files_of(self.pack(self.a.company))["README.md"].decode()

        self.assertNotIn("<script", unescaped(readme))
        self.assertEqual([line for line in headings(readme) if "heading" in line], [])
        self.assertEqual(ragged(readme), [])
        self.assertIn(
            f"| `{publication.pk}` | holding_statement | Synthetic {INERT} statement | {INERT_SYMBOL} | ", readme
        )
