import json
import runpy
import socket
import struct
import sys
import time
from pathlib import Path

apply_limits = runpy.run_path(str(Path(__file__).with_name("upload_worker_limits.py")))["apply_limits"]


def run():
    parameters = json.loads(sys.argv[1])
    apply_limits(parameters["memory_bytes"], parameters["cpu_seconds"], parameters["reply_bytes"])
    raw = sys.stdin.buffer.read(parameters["input_bytes"] + 1)
    if not raw or len(raw) > parameters["input_bytes"]:
        return 2
    deadline = time.monotonic() + parameters["seconds"]

    def remaining():
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError()
        return seconds

    with socket.create_connection((parameters["host"], parameters["port"]), timeout=remaining()) as connection:
        connection.sendall(b"zINSTREAM\0")
        for start in range(0, len(raw), 65536):
            connection.settimeout(remaining())
            chunk = raw[start : start + 65536]
            connection.sendall(struct.pack("!I", len(chunk)) + chunk)
        connection.settimeout(remaining())
        connection.sendall(struct.pack("!I", 0))
        reply = bytearray()
        while True:
            connection.settimeout(remaining())
            chunk = connection.recv(min(1024, parameters["reply_bytes"] + 1 - len(reply)))
            if not chunk:
                break
            reply.extend(chunk)
            if len(reply) > parameters["reply_bytes"]:
                return 2
        sys.stdout.buffer.write(reply)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except (OSError, ValueError, MemoryError):
        sys.exit(2)
