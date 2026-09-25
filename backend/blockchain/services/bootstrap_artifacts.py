import hashlib
import json
from pathlib import Path

from django.conf import settings
from web3 import Web3

from blockchain.exceptions import FreshSignerBootstrapError

CONTRACT_NAMES = {"share_token_factory": "ShareTokenFactory", "stablecoin": "AUDY", "atomic_swap": "AtomicSwap"}


def _json(path):
    content = path.read_bytes()
    return json.loads(content), hashlib.sha256(content).hexdigest()


def load_bootstrap_artifacts():
    root = Path(settings.BASE_DIR).parent / "contracts" / "artifacts"
    loaded = {}
    try:
        for key, name in CONTRACT_NAMES.items():
            source = f"contracts/{name}.sol"
            directory = root / source
            artifact, artifact_digest = _json(directory / f"{name}.json")
            debug, _ = _json(directory / f"{name}.dbg.json")
            build_path = (directory / debug["buildInfo"]).resolve()
            if build_path.parent != (root / "build-info").resolve():
                raise ValueError
            build, build_digest = _json(build_path)
            output = build["output"]["contracts"][source][name]
            creation = output["evm"]["bytecode"]
            runtime = output["evm"]["deployedBytecode"]
            if (
                artifact["contractName"] != name
                or artifact["sourceName"] != source
                or artifact["abi"] != output["abi"]
                or artifact["bytecode"] != "0x" + creation["object"]
                or artifact["deployedBytecode"] != "0x" + runtime["object"]
                or creation.get("linkReferences")
                or runtime.get("linkReferences")
                or not bytes.fromhex(creation["object"])
                or not bytes.fromhex(runtime["object"])
            ):
                raise ValueError
            loaded[key] = {
                "abi": artifact["abi"],
                "bytecode": artifact["bytecode"],
                "runtime": bytes.fromhex(runtime["object"]),
                "immutable_references": runtime.get("immutableReferences", {}),
                "identity": {
                    "contract": name,
                    "source": source,
                    "artifact_sha256": artifact_digest,
                    "build_sha256": build_digest,
                    "build_id": build["id"],
                    "compiler": build["solcLongVersion"],
                    "input_sha256": hashlib.sha256(
                        json.dumps(build["input"], sort_keys=True, separators=(",", ":")).encode()
                    ).hexdigest(),
                    "creation_keccak": Web3.to_hex(Web3.keccak(hexstr=artifact["bytecode"])),
                },
            }
    except Exception:
        raise FreshSignerBootstrapError("Trusted local Hardhat artifacts and build information are required.") from None
    return loaded


def verify_bootstrap_runtime(actual, artifact):
    actual = bytearray(actual)
    expected = bytearray(artifact["runtime"])
    if not actual or len(actual) != len(expected):
        raise FreshSignerBootstrapError("Deployed contract code differs from the trusted build.")
    for locations in artifact["immutable_references"].values():
        for location in locations:
            start, length = location["start"], location["length"]
            if (
                type(start) is not int
                or type(length) is not int
                or start < 0
                or length <= 0
                or start + length > len(actual)
            ):
                raise FreshSignerBootstrapError("The trusted build contains invalid immutable references.")
            actual[start : start + length] = expected[start : start + length]
    if actual != expected:
        raise FreshSignerBootstrapError("Deployed contract code differs from the trusted build.")
