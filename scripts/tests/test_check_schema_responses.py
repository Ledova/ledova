#!/usr/bin/env python3

from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check-schema-responses.py"
_spec = importlib.util.spec_from_file_location("check_schema_responses", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


def method(source: str):
    return next(n for n in ast.walk(ast.parse(source)) if isinstance(n, gate.DEFINITIONS))


class AHandBuiltSerializerIsAFinding(unittest.TestCase):

    def test_a_serializer_nested_in_an_envelope_is_found(self):
        node = method(
            "def deploy(self, request):\n" "    return Response({'message': 'ok', 'token': DetailSerializer(x).data})\n"
        )

        self.assertEqual(gate.serializers_returned(node), {"DetailSerializer"})

    def test_a_declared_method_is_exempt(self):
        node = method(
            "@extend_schema(responses=DetailSerializer)\n"
            "def create(self, request):\n"
            "    return Response(DetailSerializer(x).data)\n"
        )

        self.assertTrue(gate.declares_schema(node))


if __name__ == "__main__":
    unittest.main()
