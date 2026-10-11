import contextlib
import copy
import importlib.util
import io
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "audit-dependencies.py"
SPEC = importlib.util.spec_from_file_location("dependency_audits", SCRIPT)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class DependencyAuditTest(unittest.TestCase):
    def test_only_recorded_exceptions_survive_new_findings_and_failed_tools(self):
        npm = {
            "auditReportVersion": 2,
            "metadata": {
                "dependencies": {"total": 2},
                "vulnerabilities": {
                    "info": 0,
                    "low": 2,
                    "moderate": 0,
                    "high": 0,
                    "critical": 0,
                    "total": 2,
                },
            },
            "vulnerabilities": {
                "elliptic": {
                    "name": "elliptic",
                    "severity": "low",
                    "via": [
                        {
                            "name": "elliptic",
                            "severity": "low",
                            "url": "https://github.com/advisories/GHSA-848j-6mx2-7j84",
                        }
                    ],
                },
                "hdkey": {"name": "hdkey", "severity": "low", "via": ["elliptic"]},
            },
        }
        pip = {
            "dependencies": [
                {
                    "name": "pytest",
                    "version": "7.4.4",
                    "vulns": [{"id": "PYSEC-2026-1845"}],
                }
            ],
            "fixes": [],
        }

        def npm_validator(report):
            return AUDIT.npm_findings(report, AUDIT.MOBILE_ACCEPTED)

        for report, validator in ((npm, npm_validator), (pip, AUDIT.pip_findings)):
            with self.subTest(report=report):
                result = subprocess.CompletedProcess([], 1, json.dumps(report), "")
                with patch.object(
                    AUDIT.subprocess, "run", return_value=result
                ), contextlib.redirect_stdout(io.StringIO()):
                    AUDIT.audit(
                        ["synthetic-auditor"], SCRIPT.parent, validator, "synthetic"
                    )
                for exit_code, output in (
                    (2, json.dumps(report)),
                    (1, ""),
                    (0, "{}"),
                    (0, "not json"),
                ):
                    with self.subTest(exit_code=exit_code, output=output):
                        result = subprocess.CompletedProcess(
                            [], exit_code, output, "synthetic failure"
                        )
                        with patch.object(AUDIT.subprocess, "run", return_value=result):
                            with self.assertRaises(
                                (AUDIT.AuditFailure, KeyError, ValueError)
                            ):
                                AUDIT.audit(
                                    ["synthetic-auditor"],
                                    SCRIPT.parent,
                                    validator,
                                    "synthetic",
                                )
        for package, identifier, severity in (
            ("elliptic", "GHSA-cfgh-jmpq-rvwx", "low"),
            ("different-package", "GHSA-848j-6mx2-7j84", "low"),
            ("elliptic", "GHSA-848j-6mx2-7j84", "critical"),
        ):
            changed = copy.deepcopy(npm)
            changed["vulnerabilities"]["elliptic"]["via"][0].update(
                name=package,
                severity=severity,
                url=f"https://github.com/advisories/{identifier}",
            )
            if package != "elliptic":
                renamed = changed["vulnerabilities"].pop("elliptic")
                renamed["name"] = package
                changed["vulnerabilities"][package] = renamed
                changed["vulnerabilities"]["hdkey"]["via"] = [package]
            with self.subTest(
                package=package, identifier=identifier, severity=severity
            ):
                with self.assertRaises(AUDIT.AuditFailure):
                    npm_validator(changed)
        with self.assertRaises(AUDIT.AuditFailure):
            AUDIT.npm_findings(npm, set())
        for package, identifier in (
            ("pytest", "PYSEC-2026-new"),
            ("different-package", "PYSEC-2026-1845"),
        ):
            changed = copy.deepcopy(pip)
            changed["dependencies"][0]["name"] = package
            changed["dependencies"][0]["vulns"][0]["id"] = identifier
            with self.subTest(package=package, identifier=identifier):
                with self.assertRaises(AUDIT.AuditFailure):
                    AUDIT.pip_findings(changed)
        with patch.object(
            AUDIT.subprocess, "run", side_effect=OSError
        ), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(AUDIT.main(["node"]), 1)


if __name__ == "__main__":
    unittest.main()
