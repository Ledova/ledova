import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(os.environ["LEDOVA_MANUAL_RUNNER_ROOT"])
OPERATIONS = {"prepare", "discard", "register", "listener", "drain", "readback"}
PROFILES = {"scoped", "ordinary", "master"}


class ReservationBusy(RuntimeError):
    pass


class ReservationReleased(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def private_record(path):
    require(path.parent.resolve() == path.parent, "Reservation parent is not canonical")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor) as stream:
        info = os.fstat(stream.fileno())
        require(
            stat.S_ISREG(info.st_mode)
            and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_size <= 4096,
            "Reservation record is not private",
        )
        return stream.read()


def current_master(root):
    text = private_record(root / ".pool-lock" / "pid")
    require(
        text.endswith("\n") and text[:-1].isascii() and text[:-1].isdecimal() and int(text) > 0, "Master PID is invalid"
    )
    pid = int(text)
    os.kill(pid, 0)
    return pid


def require_context(profile, operation, controller_pid):
    require(
        type(controller_pid) is int
        and (
            (profile == "master" and operation in {"drain", "readback"} and controller_pid == 0)
            or (profile in {"scoped", "ordinary"} and operation in {"prepare", "register"} and controller_pid == 0)
            or (profile in {"scoped", "ordinary"} and operation in {"discard", "listener"} and controller_pid > 0)
        ),
        "Reservation operation is not bound to its owner",
    )


def process_parent(pid):
    text = subprocess.check_output(["/bin/ps", "-p", str(pid), "-o", "ppid="], text=True, timeout=10).strip()
    require(text.isascii() and text.isdecimal() and int(text) > 0, "Reservation process parent is unknown")
    return int(text)


def require_processes(master, holder, controller, profile, operation):
    if profile == "master":
        require(holder == master or operation == "drain", "Foreign master reservation holder")
    elif controller:
        require(
            process_parent(controller) == master
            and (holder == controller if operation == "listener" else process_parent(holder) == controller),
            "Reservation holder is not owned by this controller",
        )
    else:
        require(process_parent(holder) == master, "Reservation holder is not owned by this master")


def acquire(root, profile, operation, controller_pid=0, holder_pid=None):
    require(
        root.resolve() == root and profile in PROFILES and operation in OPERATIONS, "Reservation context is invalid"
    )
    require_context(profile, operation, controller_pid)
    master = current_master(root)
    require(
        os.environ.get("LEDOVA_POOL_OWNER_PID") == str(master)
        or profile == "master"
        and (os.getpid() == master or operation == "drain"),
        "Current master ownership is missing",
    )
    holder = os.getpid() if holder_pid is None else holder_pid
    require(
        type(holder) is int
        and holder in (os.getpid(), os.getppid())
        and type(controller_pid) is int
        and controller_pid >= 0,
        "Reservation process identity is invalid",
    )
    receipt = dict(
        master_pid=master, holder_pid=holder, controller_pid=controller_pid, profile=profile, operation=operation
    )
    require_processes(master, holder, controller_pid, profile, operation)
    gate = root / ".reservation-lock"
    try:
        gate.mkdir(mode=0o700)
    except FileExistsError:
        try:
            known_owner(root)
        except ReservationReleased:
            return acquire(root, profile, operation, controller_pid, holder_pid)
        raise ReservationBusy("Known live same-pool reservation") from None
    descriptor = os.open(gate / "owner.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(receipt, stream)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    return receipt


def known_owner(root):
    for attempt in range(6):
        try:
            return read_owner(root)
        except (FileNotFoundError, json.JSONDecodeError):
            if not os.path.lexists(root / ".reservation-lock"):
                raise ReservationReleased("Reservation released during readback") from None
            if attempt == 5:
                raise RuntimeError("Incomplete reservation requires inspection") from None
            time.sleep(0.05)


def read_owner(root):
    gate = root / ".reservation-lock"
    info = gate.lstat()
    require(
        gate.resolve() == gate
        and stat.S_ISDIR(info.st_mode)
        and info.st_uid == os.getuid()
        and stat.S_IMODE(info.st_mode) == 0o700,
        "Unknown reservation directory",
    )
    names = {item.name for item in gate.iterdir()}
    if not names:
        raise FileNotFoundError("Reservation receipt is not yet present")
    require(names == {"owner.json"}, "Unknown reservation files")
    observed = json.loads(private_record(gate / "owner.json"))
    require(
        set(observed) == {"master_pid", "holder_pid", "controller_pid", "profile", "operation"}
        and observed["master_pid"] == current_master(root)
        and observed["profile"] in PROFILES
        and observed["operation"] in OPERATIONS,
        "Foreign or old reservation",
    )
    for field in ("master_pid", "holder_pid", "controller_pid"):
        require(
            type(observed[field]) is int and observed[field] >= (0 if field == "controller_pid" else 1),
            "Invalid reservation PID",
        )
    require_context(observed["profile"], observed["operation"], observed["controller_pid"])
    os.kill(observed["holder_pid"], 0)
    require_processes(
        observed["master_pid"],
        observed["holder_pid"],
        observed["controller_pid"],
        observed["profile"],
        observed["operation"],
    )
    if observed["controller_pid"]:
        require(observed["profile"] in {"scoped", "ordinary"}, "Controller profile is invalid")
        slot = root / "slots" / observed["profile"]
        if os.path.lexists(slot / ".supervisor.pid"):
            require(
                private_record(slot / ".supervisor.pid") == str(observed["controller_pid"]) + "\n",
                "Controller reservation is unbound",
            )
        else:
            state = json.loads(private_record(slot / "evidence" / "session-state.json"))
            require(
                observed["operation"] == "discard"
                and state["state"] == "completed-and-disposed"
                and state["controller_pid"] == observed["controller_pid"]
                and not os.path.lexists(slot / ".active-vm"),
                "Disposal handoff is unbound",
            )
        os.kill(observed["controller_pid"], 0)
    return observed


def wait_acquire(root, profile, operation, controller_pid=0, holder_pid=None):
    while True:
        try:
            return acquire(root, profile, operation, controller_pid, holder_pid)
        except ReservationBusy:
            time.sleep(1)


def release(root, receipt, holder_pid=None):
    holder = os.getpid() if holder_pid is None else holder_pid
    require(
        holder in (os.getpid(), os.getppid()) and receipt["holder_pid"] == holder,
        "Only the actual reservation holder may release it",
    )
    path = root / ".reservation-lock" / "owner.json"
    require(json.loads(private_record(path)) == receipt, "Reservation ownership changed before release")
    require(current_master(root) == receipt["master_pid"], "Reservation master changed")
    os.kill(receipt["holder_pid"], 0)
    path.unlink()
    path.parent.rmdir()


def finish_disposal(root, receipt, inspection_seen, holder_pid=None):
    holder = os.getpid() if holder_pid is None else holder_pid
    require(
        known_owner(root) == receipt
        and receipt["holder_pid"] == holder
        and holder in (os.getpid(), os.getppid())
        and receipt["operation"] == "discard"
        and receipt["profile"] in {"scoped", "ordinary"}
        and receipt["controller_pid"] > 0
        and type(inspection_seen) is bool,
        "Disposal handoff is not owned",
    )
    slot = root / "slots" / receipt["profile"]
    vm = private_record(slot / ".active-vm").strip()
    prefix = "s-" if receipt["profile"] == "scoped" else "o-"
    require(
        vm.startswith(prefix) and len(vm) == 14 and all(c in "0123456789abcdef" for c in vm[2:]),
        "Disposal VM identity is invalid",
    )
    evidence = slot / "evidence" / vm
    require(evidence.resolve() == evidence, "Disposal evidence is not canonical")
    completed = json.loads(private_record(evidence / "registration-completed.json"))
    require(
        completed["vm"] == vm
        and completed["profile"] == receipt["profile"]
        and type(completed["runner_id"]) is int
        and completed["runner_id"] > 0
        and not os.path.lexists(slot / ".active-registration.json"),
        "Disposed registration is unbound",
    )
    require(
        private_record(slot / ".supervisor.pid") == str(receipt["controller_pid"]) + "\n",
        "Disposal controller ownership changed",
    )
    state_path = slot / "evidence" / "session-state.json"
    require(not state_path.is_symlink(), "Disposal state is not canonical")
    state_path.write_text(
        json.dumps(
            {
                "state": "completed-and-disposed",
                "runner_id": completed["runner_id"],
                "controller_pid": receipt["controller_pid"],
                "inspection_seen": inspection_seen,
            }
        )
        + "\n"
    )
    state_path.chmod(0o600)
    (slot / ".active-vm").rename(evidence / "disposed-vm.txt")
    (slot / ".supervisor.pid").unlink()


def main():
    os.umask(0o077)
    require(len(sys.argv) in (2, 3, 6), "Invalid reservation command")
    if sys.argv[1] == "acquire" and len(sys.argv) == 6:
        try:
            receipt = acquire(ROOT, sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
        except ReservationBusy:
            return 75
        print(json.dumps(receipt))
    elif sys.argv[1] == "release" and len(sys.argv) == 2:
        release(ROOT, json.load(sys.stdin), holder_pid=os.getppid())
    elif sys.argv[1] == "finish-disposal" and len(sys.argv) == 3:
        require(sys.argv[2] in {"true", "false"}, "Invalid inspection flag")
        finish_disposal(ROOT, json.load(sys.stdin), sys.argv[2] == "true", holder_pid=os.getppid())
    else:
        raise RuntimeError("Invalid reservation command")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
