#!/usr/bin/env python3
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import pool_reservation  # noqa: E402
import runner_main_policy as main_policy  # noqa: E402

if sys.flags.optimize:
    raise RuntimeError("Optimized Python is not allowed for registration")
os.umask(0o077)
ROOT = pathlib.Path(os.environ["LEDOVA_MANUAL_RUNNER_ROOT"])
PROFILES = main_policy.PROFILES
assert len(sys.argv) in (2, 3) and sys.argv[1] in PROFILES
role = sys.argv[1]
gid, label, prefix = PROFILES[role]
state = ROOT / "slots" / role
policy = None
if len(sys.argv) == 3:
    policy_path = pathlib.Path(sys.argv[2])
    assert policy_path == state / ".pending-job.json" and policy_path.resolve() == policy_path
    policy = main_policy.policy_from_receipt(json.loads(policy_path.read_text()))
    assert policy.profile == role
if (ROOT / ".pool-lock").exists():
    assert os.environ.get("LEDOVA_POOL_OWNER_PID") == (ROOT / ".pool-lock" / "pid").read_text().strip()
assert ROOT.resolve() == ROOT and state.resolve() == state
assert not (state / ".active-registration.json").exists()
assert not (state / ".supervisor.pid").exists() and not (state / ".lifecycle-lock").exists()
env = dict(os.environ, LIMA_HOME=str(ROOT / "lima"))
lima = "/opt/homebrew/bin/limactl"


def api(path, method="GET"):
    return json.loads(subprocess.check_output(["gh", "api", "--method", method, path], text=True, timeout=30))


def guest(cmd, **kwargs):
    return subprocess.run(
        [lima, "shell", "--tty=false", "--workdir", "/opt/actions-runner", vm, "bash", "-lc", cmd],
        env=env,
        check=True,
        timeout=90,
        **kwargs,
    )


lock = state / ".lifecycle-lock"
lock.mkdir(mode=0o700)
attempt = state / ".registration-attempt.json"
completed = False
try:
    assert not attempt.exists()
    reservation = pool_reservation.wait_acquire(ROOT, role, "register")
    try:
        assert policy is not None or not (ROOT / ".drain").exists()
        vm = (state / ".active-vm").read_text().strip()
        assert re.fullmatch(prefix + r"-[0-9a-f]{12}", vm)
        runner_name = "ledova-mac-" + role + "-arm64-" + vm[2:]
        attempt.write_text(
            json.dumps(
                {
                    "profile": role,
                    "vm": vm,
                    "group_id": gid,
                    "runner_name": runner_name,
                    "stage": "closed-registration-in-progress",
                    "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                },
                indent=2,
            )
            + "\n"
        )
    finally:
        pool_reservation.release(ROOT, reservation)
    group = api(f"orgs/Ledova/actions/runner-groups/{gid}")
    repos = api(f"orgs/Ledova/actions/runner-groups/{gid}/repositories")
    members = api(f"orgs/Ledova/actions/runner-groups/{gid}/runners")
    assert (
        group["name"] == label
        and group["visibility"] == "selected"
        and group["default"] is False
        and group["inherited"] is False
    )
    assert members["total_count"] == 0 and not members["runners"]
    if policy is None:
        assert group["allows_public_repositories"] is False and repos["total_count"] == 0 and not repos["repositories"]
    else:
        assert group["allows_public_repositories"] is True and group["restricted_to_workflows"] is True
        assert group["selected_workflows"] == [policy.as_receipt()["workflow"]]
        assert repos["total_count"] == 1 and [(i["id"], i["full_name"]) for i in repos["repositories"]] == [
            (main_policy.REPOSITORY_ID, main_policy.REPOSITORY)
        ]
    evidence = state / "evidence" / vm
    evidence.mkdir(mode=0o700, exist_ok=True)
    guest(
        'set -e; test ! -e .runner; test -z "$(pgrep -x Runner.Listener || true)"; '
        'test -z "$(pgrep -x Runner.Worker || true)"',
        stdout=subprocess.DEVNULL,
    )
    secret_path = None
    try:
        token = api("orgs/Ledova/actions/runners/registration-token", "POST")["token"]
        fd, name = tempfile.mkstemp(prefix=".registration-", dir=ROOT)
        secret_path = pathlib.Path(name)
        with os.fdopen(fd, "w") as f:
            f.write(token)
        del token
        subprocess.run(
            [
                lima,
                "copy",
                "--tty=false",
                "--backend=scp",
                str(secret_path),
                vm + ":/opt/actions-runner/.registration-input-token",
            ],
            env=env,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        labels = label if policy is None else ",".join(policy.as_receipt()["requested_labels"])
        cmd = (
            "set +x; set -e; chmod 600 .registration-input-token; "
            'trap "rm -f .registration-input-token" EXIT; '
            'export ACTIONS_RUNNER_INPUT_TOKEN="$(cat .registration-input-token)"; '
            "./config.sh --unattended --url https://github.com/Ledova --name "
            + runner_name
            + " --runnergroup "
            + label
            + " --labels "
            + labels
            + " --ephemeral --work _work"
        )
        with (evidence / "registration-config-private.log").open("ab") as log:
            guest(cmd, stdout=log, stderr=log)
    finally:
        if secret_path is not None:
            secret_path.unlink(missing_ok=True)
        guest("rm -f .registration-input-token", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    settings = json.loads(
        guest(
            "jq -c '{agentId,agentName,poolId,poolName,ephemeral,gitHubUrl,workFolder}' .runner",
            text=True,
            capture_output=True,
        ).stdout.lstrip("\ufeff")
    )
    assert (
        settings["agentName"] == runner_name
        and settings["poolId"] == gid
        and settings["poolName"] == label
        and settings["ephemeral"] is True
    )
    assert settings["gitHubUrl"] == "https://github.com/Ledova" and settings["workFolder"] == "_work"
    rid = settings["agentId"]
    runner = api(f"orgs/Ledova/actions/runners/{rid}")
    members = api(f"orgs/Ledova/actions/runner-groups/{gid}/runners")
    assert (
        runner["id"] == rid
        and runner["name"] == runner_name
        and runner["busy"] is False
        and runner["status"] == "offline"
        and runner["os"].casefold() == "linux"
    )
    assert {"self-hosted", "Linux", "ARM64", label} <= {i["name"] for i in runner["labels"]}
    if policy is not None:
        assert set(policy.as_receipt()["requested_labels"]) <= {i["name"] for i in runner["labels"]}
    guest(
        'set -e; test -z "$(pgrep -x Runner.Listener || true)"; test -z "$(pgrep -x Runner.Worker || true)"',
        stdout=subprocess.DEVNULL,
    )
    assert members["total_count"] == 1 and {i["id"] for i in members["runners"]} == {rid}
    final_group = api(f"orgs/Ledova/actions/runner-groups/{gid}")
    final_repos = api(f"orgs/Ledova/actions/runner-groups/{gid}/repositories")
    assert final_group["id"] == gid and final_group["name"] == label
    assert (
        final_group["visibility"] == "selected"
        and final_group["default"] is False
        and final_group["inherited"] is False
    )
    if policy is None:
        assert (
            final_group["allows_public_repositories"] is False
            and final_repos["total_count"] == 0
            and not final_repos["repositories"]
        )
    else:
        assert final_group["allows_public_repositories"] is True and final_group["restricted_to_workflows"] is True
        assert final_group["selected_workflows"] == [policy.as_receipt()["workflow"]]
        assert final_repos["total_count"] == 1 and [(i["id"], i["full_name"]) for i in final_repos["repositories"]] == [
            (main_policy.REPOSITORY_ID, main_policy.REPOSITORY)
        ]
    now = datetime.datetime.now(datetime.timezone.utc)
    receipt = {
        "profile": role,
        "vm": vm,
        "group_id": gid,
        "label": label,
        "runner_id": rid,
        "runner_name": runner_name,
        "ephemeral": True,
        "resources": {"cpus": 6, "memory_gib": 12, "disk_gib": 60},
        "created_at": now.isoformat(),
        "idle_deadline": (now + datetime.timedelta(hours=8)).isoformat(),
    }
    if policy is not None:
        receipt["access_policy"] = policy.as_receipt()
        receipt["idle_deadline"] = (now + datetime.timedelta(hours=3)).isoformat()
    os.umask(0o077)
    (state / ".active-registration.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (evidence / "offline-registration-readback.json").write_text(
        json.dumps(
            {
                "at": now.isoformat(),
                "settings": settings,
                "runner": runner,
                "members": members,
                "group": final_group,
                "repositories": final_repos,
                "receipt": receipt,
            },
            indent=2,
        )
        + "\n"
    )
    print(
        json.dumps(
            {
                "profile": role,
                "runner_id": rid,
                "name": runner_name,
                "registered_offline": True,
                "idle_deadline": receipt["idle_deadline"],
            }
        )
    )
    completed = True
    attempt.unlink()
finally:
    if completed or not attempt.exists():
        lock.rmdir()
    else:
        print("Closed registration needs inspection; retained profile lock, VM and attempt receipt.", file=sys.stderr)
