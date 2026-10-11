#!/usr/bin/env python3
import datetime
import json
import os
import pathlib
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time

import pool_reservation
import runner_main_policy as main_policy

ROOT = pathlib.Path(os.environ["LEDOVA_MANUAL_RUNNER_ROOT"])
STATE = ROOT / "slots" / "scoped"
WORKFLOW = "Ledova/ledova/.github/workflows/ci.yml@refs/heads/main"
PROFILES = main_policy.PROFILES
REPOSITORY = (main_policy.REPOSITORY_ID, main_policy.REPOSITORY)
ENV = dict(os.environ, LIMA_HOME=str(ROOT / "lima"), LEDOVA_POOL_OWNER_PID=str(os.getpid()))
STOP = False


class PoolStopped(RuntimeError):
    pass


class TransientReadError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def require_running():
    if STOP or (ROOT / ".drain").exists():
        raise PoolStopped("Pool stopped during admission")


def write_json(path, value):
    require(path.parent.resolve() == path.parent, "Evidence parent is not canonical")
    require(not path.is_symlink(), "Evidence path is a symlink")
    fd, name = tempfile.mkstemp(prefix=".pool-write-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)


def report(state, **fields):
    value = {
        "state": state,
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "owner_pid": os.getpid(),
        **fields,
    }
    write_json(ROOT / "evidence" / "ongoing-pool-state.json", value)
    print(json.dumps(value), flush=True)


def api(path, method="GET", body=None):
    command = ["gh", "api", "--method", method, path]
    if body is not None:
        command += ["--input", "-"]
    try:
        result = subprocess.run(
            command, input=None if body is None else json.dumps(body), text=True, capture_output=True, timeout=30
        )
    except subprocess.TimeoutExpired:
        if method == "GET":
            raise TransientReadError("GitHub read timed out: " + path) from None
        raise RuntimeError("GitHub write timed out: " + path) from None
    if result.returncode != 0 and method == "GET":
        status = re.search(r"\(HTTP ([0-9]{3})\)", result.stderr)
        transient = (status and (status[1] == "429" or status[1].startswith("5"))) or (
            not status
            and re.search(
                r"(?i)(i/o timeout|context deadline exceeded|connection refused|connection reset|"
                r"temporary failure in name resolution|no such host|TLS handshake timeout|network is unreachable)",
                result.stderr,
            )
        )
        if transient:
            raise TransientReadError("GitHub read temporarily unavailable: " + path)
    require(result.returncode == 0, "GitHub request failed: " + path)
    return json.loads(result.stdout) if result.stdout.strip() else None


def configuration():
    path = ROOT / "main-pool-policy.json"
    require(path.resolve() == path and path.is_file(), "Reviewed ongoing policy is missing")
    config = json.loads(path.read_text())
    require(
        set(config)
        == {
            "workflow",
            "workflow_id",
            "reviewed_delivery_sha",
            "reviewed_delivery_tree",
            "approved_workflow_blob_sha",
            "independent_review_url",
            "profiles",
        },
        "Unknown ongoing policy fields",
    )
    require(
        config["workflow"] == WORKFLOW and config["profiles"] == ["scoped", "ordinary"], "Unsupported ongoing route"
    )
    require(type(config["workflow_id"]) is int and config["workflow_id"] > 0, "Invalid workflow ID")
    for field in ("reviewed_delivery_sha", "reviewed_delivery_tree", "approved_workflow_blob_sha"):
        require(isinstance(config[field], str) and re.fullmatch("[0-9a-f]{40}", config[field]), "Invalid source pin")
    require(
        isinstance(config["independent_review_url"], str)
        and re.fullmatch(
            r"https://github\.com/Ledova/ledova/pull/[1-9][0-9]*#issuecomment-[1-9][0-9]*",
            config["independent_review_url"],
        ),
        "Independent review receipt is missing",
    )
    commit = api("repos/Ledova/ledova/git/commits/" + config["reviewed_delivery_sha"])
    require(
        commit["sha"] == config["reviewed_delivery_sha"] and commit["tree"]["sha"] == config["reviewed_delivery_tree"],
        "Delivered tree changed",
    )
    definition = api("repos/Ledova/ledova/contents/.github/workflows/ci.yml?ref=" + config["reviewed_delivery_sha"])
    require(
        definition["type"] == "file"
        and definition["path"] == ".github/workflows/ci.yml"
        and definition["sha"] == config["approved_workflow_blob_sha"],
        "Delivered workflow changed",
    )
    workflow = api("repos/Ledova/ledova/actions/workflows/ci.yml")
    require(
        workflow["id"] == config["workflow_id"]
        and workflow["path"] == ".github/workflows/ci.yml"
        and workflow["state"] == "active",
        "Approved CI workflow changed",
    )
    return config


def group_snapshot(expected_runner=None, allow_absent=False, profile="scoped"):
    group_id, group_name, _ = PROFILES[profile]
    group = api(f"orgs/Ledova/actions/runner-groups/{group_id}")
    repos = api(f"orgs/Ledova/actions/runner-groups/{group_id}/repositories")
    members = api(f"orgs/Ledova/actions/runner-groups/{group_id}/runners")
    require(
        group["id"] == group_id
        and group["name"] == group_name
        and group["default"] is False
        and group["inherited"] is False
        and group["visibility"] == "selected",
        "Owned group identity changed",
    )
    require(repos["total_count"] == len(repos["repositories"]), "Repository listing is incomplete")
    require(members["total_count"] == len(members["runners"]), "Runner listing is incomplete")
    ids = {item["id"] for item in members["runners"]}
    expected_ids = set() if expected_runner is None else {expected_runner}
    require(ids == expected_ids or (allow_absent and not ids), "Owned group membership changed")
    repository_set = {(item["id"], item["full_name"]) for item in repos["repositories"]}
    require(repository_set <= {REPOSITORY}, "Foreign repository access detected")
    return group, repository_set


def closed_group(expected_runner=None, profile="scoped"):
    group_id, group_name, _ = PROFILES[profile]
    group, repos = group_snapshot(expected_runner, profile=profile)
    require(not repos and group["allows_public_repositories"] is False, "Closed group required")
    require(group["selected_workflows"] in ([], [WORKFLOW]), "Foreign workflow restriction detected")
    return group


def ready_group(expected_runner=None, allow_absent=False, profile="scoped"):
    group_id, group_name, _ = PROFILES[profile]
    group, repos = group_snapshot(expected_runner, allow_absent=allow_absent, profile=profile)
    require(
        repos == {REPOSITORY}
        and group["allows_public_repositories"] is True
        and group["restricted_to_workflows"] is True
        and group["selected_workflows"] == [WORKFLOW],
        "Exact permanent eligibility required",
    )
    return group


def idle_group(profile="scoped"):
    group, repos = group_snapshot(profile=profile)
    if not repos and group["allows_public_repositories"] is False:
        require(group["selected_workflows"] in ([], [WORKFLOW]), "Closed idle workflow changed")
        return "closed"
    ready_group(profile=profile)
    return "ready"


def close_group(expected_runner, profile="scoped"):
    group_id, group_name, _ = PROFILES[profile]
    group, repos = group_snapshot(expected_runner, allow_absent=True, profile=profile)
    if not repos and group["allows_public_repositories"] is False:
        require(group["selected_workflows"] in ([], [WORKFLOW]), "Closed workflow policy changed")
        return
    require(
        group["restricted_to_workflows"] is True and group["selected_workflows"] == [WORKFLOW],
        "Withdrawal workflow policy changed",
    )
    if repos:
        api(f"orgs/Ledova/actions/runner-groups/{group_id}/repositories/{REPOSITORY[0]}", "DELETE")
    group, repos = group_snapshot(expected_runner, allow_absent=True, profile=profile)
    require(not repos, "Repository withdrawal unconfirmed")
    if group["allows_public_repositories"]:
        api(
            f"orgs/Ledova/actions/runner-groups/{group_id}",
            "PATCH",
            {
                "name": group_name,
                "allows_public_repositories": False,
                "restricted_to_workflows": True,
                "selected_workflows": [WORKFLOW],
            },
        )
    group, repos = group_snapshot(expected_runner, allow_absent=True, profile=profile)
    require(not repos and group["allows_public_repositories"] is False, "Withdrawal readback failed")
    require(
        group["restricted_to_workflows"] is True and group["selected_workflows"] == [WORKFLOW],
        "Withdrawal workflow readback failed",
    )


def attempt_jobs(run_id, attempt):
    jobs = []
    page = 1
    total = None
    while total is None or len(jobs) < total:
        data = api(f"repos/Ledova/ledova/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100&page={page}")
        require(type(data["total_count"]) is int and data["total_count"] >= 0, "Invalid job inventory")
        if total is None:
            total = data["total_count"]
        require(data["total_count"] == total, "Job inventory moved during listing")
        require(data["jobs"] or total == 0, "Job listing stopped early")
        jobs.extend(data["jobs"])
        require(len(jobs) <= total, "Job listing exceeds inventory")
        page += 1
    require(len({job["id"] for job in jobs}) == len(jobs), "Duplicate job identity")
    return jobs


def facts(config, run_id, attempt, job_id):
    run = api(f"repos/Ledova/ledova/actions/runs/{run_id}")
    attempt_record = api(f"repos/Ledova/ledova/actions/runs/{run_id}/attempts/{attempt}")
    job = api(f"repos/Ledova/ledova/actions/jobs/{job_id}")
    sha = attempt_record["head_sha"]
    require(isinstance(sha, str) and re.fullmatch("[0-9a-f]{40}", sha), "Invalid captured source")
    main = api("repos/Ledova/ledova/git/ref/heads/main")
    main_sha = main["object"]["sha"]
    require(isinstance(main_sha, str) and re.fullmatch("[0-9a-f]{40}", main_sha), "Invalid main source")
    return main_policy.build_queued_policy(
        run=run,
        attempt=attempt_record,
        job=job,
        commit=api("repos/Ledova/ledova/git/commits/" + sha),
        main_ref=main,
        main_comparison=api("repos/Ledova/ledova/compare/" + sha + "..." + main_sha),
        delivery_comparison=api("repos/Ledova/ledova/compare/" + config["reviewed_delivery_sha"] + "..." + sha),
        workflow_definition=api("repos/Ledova/ledova/contents/.github/workflows/ci.yml?ref=" + sha),
        reviewed_delivery_sha=config["reviewed_delivery_sha"],
        approved_workflow_blob_sha=config["approved_workflow_blob_sha"],
        approved_workflow_id=config["workflow_id"],
    )


def queued_policies(config, available):
    candidates = []
    observed = set()
    for status in ("queued", "in_progress"):
        page = 1
        while True:
            data = api(
                f'repos/Ledova/ledova/actions/workflows/{config["workflow_id"]}/runs?branch=main'
                f"&status={status}&per_page=100&page={page}"
            )
            runs = data["workflow_runs"]
            for run in runs:
                run_id, attempt = run["id"], run["run_attempt"]
                require(
                    type(run_id) is int and run_id > 0 and type(attempt) is int and attempt > 0,
                    "Invalid actual run identity",
                )
                if (run_id, attempt) in observed:
                    continue
                observed.add((run_id, attempt))
                label = f"ledova-main-{run_id}-{attempt}"
                for job in attempt_jobs(run_id, attempt):
                    if job["status"] != "queued" or label not in job["labels"]:
                        continue
                    selected = [profile for profile in available if PROFILES[profile][1] in job["labels"]]
                    require(len(selected) <= 1, "Queued job requests both profiles")
                    if selected:
                        candidates.append((run["created_at"], run_id, attempt, job["id"], selected[0]))
            if len(runs) < 100:
                break
            page += 1
    policies = {}
    for _, run_id, attempt, job_id, profile in sorted(candidates):
        if profile in policies:
            continue
        policy = facts(config, run_id, attempt, job_id)
        if policy is not None:
            require(policy.profile == profile, "Job name and allocated profile differ")
            policies[profile] = policy
    return policies


def require_clean_slot(profile="scoped"):
    state = ROOT / "slots" / profile
    require(state.resolve() == state and state.is_dir(), "Profile path is not canonical")
    for name in (
        ".active-vm",
        ".active-registration.json",
        ".supervisor.pid",
        ".lifecycle-lock",
        ".registration-attempt.json",
        ".pending-job.json",
    ):
        require(not os.path.lexists(state / name), "Profile has unresolved state: " + name)
    require_disposed_state(state)
    idle_group(profile=profile)


def idle_access_state(profile="scoped"):
    require_clean_slot(profile=profile)
    return idle_group(profile=profile)


def enable_idle_access(profile="scoped"):
    state = ROOT / "slots" / profile
    group_id, group_name, _ = PROFILES[profile]
    if retry_idle_read(lambda: idle_access_state(profile)) == "ready":
        require_running()
        return
    lock = state / ".lifecycle-lock"
    lock.mkdir(mode=0o700)
    try:
        require_running()
        closed_group(profile=profile)
        api(
            f"orgs/Ledova/actions/runner-groups/{group_id}",
            "PATCH",
            {"name": group_name, "restricted_to_workflows": True, "selected_workflows": [WORKFLOW]},
        )
        group = closed_group(profile=profile)
        require(
            group["restricted_to_workflows"] is True and group["selected_workflows"] == [WORKFLOW],
            "Closed workflow restriction unconfirmed",
        )
        require_running()
        api(
            f"orgs/Ledova/actions/runner-groups/{group_id}",
            "PATCH",
            {
                "name": group_name,
                "allows_public_repositories": True,
                "restricted_to_workflows": True,
                "selected_workflows": [WORKFLOW],
            },
        )
        group, repos = group_snapshot(profile=profile)
        require(
            not repos
            and group["allows_public_repositories"] is True
            and group["restricted_to_workflows"] is True
            and group["selected_workflows"] == [WORKFLOW],
            "Listener-free intermediate eligibility changed",
        )
        require_running()
        api(
            f"orgs/Ledova/actions/runner-groups/{group_id}/repositories",
            "PUT",
            {"selected_repository_ids": [REPOSITORY[0]]},
        )
        group = ready_group(profile=profile)
        require_running()
        write_json(
            state / "evidence" / "main-idle-access-readback.json",
            {"group": group, "repository": list(REPOSITORY), "runner_ids": []},
        )
    except Exception:
        close_group(None, profile=profile)
        raise
    finally:
        lock.rmdir()


def request_drain():
    no_master = not os.path.lexists(ROOT / ".pool-lock")
    if not no_master:
        text = read_private_file(ROOT / ".pool-lock" / "pid")
        require(re.fullmatch(r"[1-9][0-9]*\n", text) is not None, "Invalid retained master PID")
        try:
            os.kill(int(text), 0)
        except ProcessLookupError:
            no_master = True
    if no_master:
        gate = ROOT / ".reservation-lock"
        gate.mkdir(mode=0o700)
        try:
            (ROOT / ".drain").touch()
        finally:
            gate.rmdir()
        return
    reservation = pool_reservation.wait_acquire(ROOT, "master", "drain")
    try:
        (ROOT / ".drain").touch(mode=0o600, exist_ok=True)
    finally:
        pool_reservation.release(ROOT, reservation)


def frozen_job(policy):
    job = api(f"repos/Ledova/ledova/actions/jobs/{policy.job_id}")
    main_policy.assert_policy_unchanged(
        policy,
        run=api(f"repos/Ledova/ledova/actions/runs/{policy.run_id}"),
        attempt=api(f"repos/Ledova/ledova/actions/runs/{policy.run_id}/attempts/{policy.run_attempt}"),
        job=job,
        commit=api("repos/Ledova/ledova/git/commits/" + policy.sha),
        workflow_definition=api("repos/Ledova/ledova/contents/.github/workflows/ci.yml?ref=" + policy.sha),
    )
    return job


def activate(policy, receipt):
    profile = policy.profile
    state = ROOT / "slots" / profile
    group_id, group_name, _ = PROFILES[profile]
    runner_id = receipt["runner_id"]
    require(
        receipt["profile"] == profile
        and receipt["group_id"] == group_id
        and receipt["ephemeral"] is True
        and receipt["label"] == group_name
        and receipt["resources"] == {"cpus": 6, "memory_gib": 12, "disk_gib": 60}
        and receipt["access_policy"] == policy.as_receipt(),
        "Fresh receipt differs from queued policy",
    )
    require(not (state / ".lifecycle-lock").exists(), "Registration handoff remains locked")
    lock = state / ".lifecycle-lock"
    lock.mkdir(mode=0o700)
    try:
        require_running()
        ready_group(runner_id, profile=profile)
        runner = api(f"orgs/Ledova/actions/runners/{runner_id}")
        require(
            runner["id"] == runner_id
            and runner["name"] == receipt["runner_name"]
            and runner["busy"] is False
            and runner["status"] == "offline"
            and {"self-hosted", "Linux", "ARM64", *policy.as_receipt()["requested_labels"]}
            <= {label["name"] for label in runner["labels"]},
            "Fresh offline runner readback failed",
        )
        result = subprocess.run(
            [
                "/opt/homebrew/bin/limactl",
                "shell",
                "--tty=false",
                "--workdir",
                "/opt/actions-runner",
                receipt["vm"],
                "bash",
                "-lc",
                'set -e; test -z "$(pgrep -x Runner.Listener || true)"; test -z "$(pgrep -x Runner.Worker || true)"; '
                "jq -c '{agentId,agentName,poolId,poolName,ephemeral,gitHubUrl,workFolder}' .runner",
            ],
            env=ENV,
            check=True,
            text=True,
            capture_output=True,
            timeout=30,
        )
        settings = json.loads(result.stdout.lstrip("\ufeff"))
        require(
            settings
            == {
                "agentId": runner_id,
                "agentName": receipt["runner_name"],
                "poolId": group_id,
                "poolName": group_name,
                "ephemeral": True,
                "gitHubUrl": "https://github.com/Ledova",
                "workFolder": "_work",
            },
            "Fresh guest registration does not match receipt",
        )
        group = ready_group(runner_id, profile=profile)
        require_running()
        write_json(
            state / "evidence" / receipt["vm"] / "main-access-readback.json",
            {
                "group": group,
                "repositories": [list(REPOSITORY)],
                "runner": runner,
                "guest_settings": settings,
                "policy": policy.as_receipt(),
            },
        )
    except Exception:
        if (state / ".active-registration.json").exists():
            close_group(runner_id, profile=profile)
        raise
    finally:
        lock.rmdir()


def prepare_job(config, policy):
    profile = policy.profile
    state = ROOT / "slots" / profile
    require_clean_slot(profile=profile)
    write_json(state / ".pending-job.json", policy.as_receipt())
    report("preparing", run_id=policy.run_id, attempt=policy.run_attempt, job_id=policy.job_id)
    result = subprocess.run([str(ROOT / "runner-host"), "prepare", profile], env=ENV)
    if result.returncode == 75:
        try:
            pool_reservation.known_owner(ROOT)
        except pool_reservation.ReservationReleased:
            pass
        require(
            not any(
                (state / name).exists()
                for name in (".active-vm", ".active-registration.json", ".supervisor.pid", ".lifecycle-lock")
            ),
            "Busy preparation mutated profile state",
        )
        require(
            json.loads((state / ".pending-job.json").read_text()) == policy.as_receipt(),
            "Pending job changed during contention",
        )
        (state / ".pending-job.json").unlink()
        return None
    require(result.returncode == 0, "Preparation needs inspection")
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "evidence" / "register-two-slot-closed.py"),
            profile,
            str(state / ".pending-job.json"),
        ],
        env=ENV,
        check=True,
    )
    receipt = json.loads((state / ".active-registration.json").read_text())
    require(configuration() == config, "Reviewed policy changed during preparation")
    job = frozen_job(policy)
    cancelled = (
        job["status"] == "completed"
        and job["conclusion"] in ("cancelled", "skipped")
        and job.get("runner_id") in (None, 0)
    )
    require(job["status"] == "queued" or cancelled, "Queued job was assigned elsewhere during preparation")
    if STOP and not (ROOT / ".drain").exists():
        request_drain()
    if not cancelled and not STOP and not (ROOT / ".drain").exists():
        try:
            activate(policy, receipt)
        except PoolStopped:
            if not (ROOT / ".drain").exists():
                request_drain()
    with (state / "evidence" / receipt["vm"] / "pool-controller.log").open("ab", buffering=0) as output:
        process = subprocess.Popen(
            [sys.executable, str(ROOT / "runner-session.py"), profile],
            env=ENV,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=output,
        )
    report(
        "supervising",
        profile=profile,
        run_id=policy.run_id,
        attempt=policy.run_attempt,
        job_id=policy.job_id,
        runner_id=receipt["runner_id"],
    )
    return {"policy": policy, "receipt": receipt, "process": process}


def complete_job(handle):
    policy, receipt, process = handle["policy"], handle["receipt"], handle["process"]
    profile = policy.profile
    slot = ROOT / "slots" / profile
    require(process.poll() is not None, "Owned controller is still running")
    require(process.returncode == 0, "Owned controller needs inspection")
    disposal = json.loads((slot / "evidence" / "session-state.json").read_text())
    require(
        disposal["state"] == "completed-and-disposed"
        and disposal["runner_id"] == receipt["runner_id"]
        and disposal["controller_pid"] == process.pid
        and disposal.get("inspection_seen") is False,
        "Owned lifecycle did not complete cleanly",
    )
    require(
        not (slot / ".active-registration.json").exists()
        and not (slot / ".active-vm").exists()
        and not (slot / ".supervisor.pid").exists()
        and not (slot / ".lifecycle-lock").exists(),
        "Disposed slot retains live guards",
    )
    idle_group(profile=profile)
    job = api(f"repos/Ledova/ledova/actions/jobs/{policy.job_id}")
    write_json(slot / "evidence" / receipt["vm"] / "job-final-readback.json", job)
    (slot / ".pending-job.json").unlink()
    report(
        "job-disposed",
        run_id=policy.run_id,
        attempt=policy.run_attempt,
        job_id=policy.job_id,
        runner_id=receipt["runner_id"],
        conclusion=job["conclusion"],
    )


def stop_requested(signum, frame):
    global STOP
    STOP = True


def withdraw_after_error(profile="scoped"):
    state = ROOT / "slots" / profile
    group_id, group_name, _ = PROFILES[profile]
    expected_runner = None
    path = state / ".active-registration.json"
    if path.exists():
        require(path.resolve() == path, "Error withdrawal receipt is not canonical")
        receipt = json.loads(path.read_text())
        require(
            receipt["profile"] == profile
            and receipt["group_id"] == group_id
            and receipt["label"] == group_name
            and receipt["ephemeral"] is True
            and type(receipt["runner_id"]) is int
            and receipt["runner_id"] > 0
            and re.fullmatch(PROFILES[profile][2] + r"-[0-9a-f]{12}", receipt["vm"])
            and receipt["runner_name"] == "ledova-mac-" + profile + "-arm64-" + receipt["vm"][2:]
            and (state / ".active-vm").read_text().strip() == receipt["vm"],
            "Error withdrawal receipt identity changed",
        )
        main_policy.policy_from_receipt(receipt["access_policy"])
        expected_runner = receipt["runner_id"]
    close_group(expected_runner, profile=profile)


def require_local_idle():
    require(ROOT.resolve() == ROOT and STATE.resolve() == STATE, "Unexpected private pool path")
    for name in (".active-vm", ".active-registration.json", ".supervisor.pid", ".lifecycle-lock"):
        require(not os.path.lexists(ROOT / name), "Global pool guard remains: " + name)
    for name in (".drain", ".reservation-lock"):
        require(not os.path.lexists(ROOT / name), "Pool is stopped or reserved: " + name)
    service = ROOT / "evidence" / "durable-service-state.json"
    if os.path.lexists(service):
        require(service.resolve() == service and service.is_file(), "Service state is not canonical")
        require(json.loads(service.read_text())["state"] != "blocked", "Durable service needs inspection")
    for profile in ("scoped", "ordinary"):
        directory = ROOT / "slots" / profile
        require(directory.resolve() == directory and directory.is_dir(), "Profile path is not canonical")
        for name in (
            ".active-vm",
            ".active-registration.json",
            ".supervisor.pid",
            ".lifecycle-lock",
            ".registration-attempt.json",
            ".pending-job.json",
        ):
            require(not os.path.lexists(directory / name), "Profile is not reconciled: " + name)
        path = directory / "evidence" / "session-state.json"
        if os.path.lexists(path):
            require(path.resolve() == path and path.is_file(), "Session state is not canonical")
            state = json.loads(path.read_text())
            require(
                state["state"] == "completed-and-disposed" and state.get("inspection_seen") is False,
                "Session is not proved disposed without inspection",
            )


def require_stopped_base():
    inventory = subprocess.check_output(["/opt/homebrew/bin/limactl", "list", "--json"], env=ENV, text=True, timeout=30)
    rows = [json.loads(line) for line in inventory.splitlines()]
    require(
        len(rows) == 1 and rows[0]["name"] == main_policy.BASE_VM and rows[0]["status"] == "Stopped",
        "Idle recovery found unresolved guest inventory",
    )


def idle_readback():
    config = configuration()
    for profile in PROFILES:
        idle_group(profile=profile)
    return config


def service_report(state, **fields):
    write_json(
        ROOT / "evidence" / "durable-service-state.json",
        {
            "state": state,
            "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "owner_pid": os.getpid(),
            **fields,
        },
    )
    print(json.dumps({"service_state": state, **fields}), flush=True)


def retry_idle_read(action):
    while True:
        require_running()
        require_local_idle()
        require_stopped_base()
        try:
            return action()
        except TransientReadError:
            require_local_idle()
            require_stopped_base()
            service_report("idle-read-retry", retry_seconds=30)
            for _ in range(6):
                require_running()
                time.sleep(5)


def require_known_pool(active):
    try:
        reservation = pool_reservation.acquire(ROOT, "master", "readback")
    except pool_reservation.ReservationBusy:
        return False
    try:
        known_pool_readback(active)
        return True
    finally:
        pool_reservation.release(ROOT, reservation)


def known_pool_readback(active):
    for name in (".active-vm", ".active-registration.json", ".supervisor.pid", ".lifecycle-lock"):
        require(not os.path.lexists(ROOT / name), "Legacy global pool guard remains")
    expected = {main_policy.BASE_VM}
    for profile in PROFILES:
        slot = ROOT / "slots" / profile
        require(slot.resolve() == slot, "Profile path changed")
        if profile not in active:
            for name in (
                ".active-vm",
                ".active-registration.json",
                ".supervisor.pid",
                ".lifecycle-lock",
                ".registration-attempt.json",
                ".pending-job.json",
            ):
                require(not os.path.lexists(slot / name), "Idle profile has unresolved state")
            require_disposed_state(slot)
            continue
        handle = active[profile]
        policy, receipt = handle["policy"], handle["receipt"]
        require(
            policy.profile == profile
            and receipt["profile"] == profile
            and receipt["group_id"] == policy.group_id
            and receipt["label"] == policy.profile_label
            and receipt["ephemeral"] is True
            and receipt["access_policy"] == policy.as_receipt()
            and receipt["resources"] == {"cpus": 6, "memory_gib": 12, "disk_gib": 60},
            "Active peer ownership changed",
        )
        require(
            type(receipt["runner_id"]) is int
            and receipt["runner_id"] > 0
            and re.fullmatch(PROFILES[profile][2] + r"-[0-9a-f]{12}", receipt["vm"])
            and receipt["runner_name"] == "ledova-mac-" + profile + "-arm64-" + receipt["vm"][2:],
            "Active peer identity changed",
        )
        require(
            json.loads((slot / ".pending-job.json").read_text()) == policy.as_receipt(), "Active pending job changed"
        )
        if os.path.lexists(slot / ".active-vm"):
            require(read_private_file(slot / ".active-vm") == receipt["vm"] + "\n", "Active peer guest changed")
            if os.path.lexists(slot / ".active-registration.json"):
                require(
                    json.loads(read_private_file(slot / ".active-registration.json")) == receipt,
                    "Active registration receipt changed",
                )
            expected.add(receipt["vm"])
        else:
            state = json.loads((slot / "evidence" / "session-state.json").read_text())
            require(
                state
                == {
                    "state": "completed-and-disposed",
                    "runner_id": receipt["runner_id"],
                    "controller_pid": handle["process"].pid,
                    "inspection_seen": False,
                },
                "Active peer disappearance is unproved",
            )
        if os.path.lexists(slot / ".supervisor.pid"):
            require(
                read_private_file(slot / ".supervisor.pid") == str(handle["process"].pid) + "\n",
                "Active peer controller changed",
            )
        require(not (slot / ".registration-attempt.json").exists(), "Active peer registration is unresolved")
        state_path = slot / "evidence" / "session-state.json"
        if state_path.exists():
            require(
                json.loads(state_path.read_text()).get("state") != "needs-inspection", "Active peer needs inspection"
            )
    rows = [
        json.loads(line)
        for line in subprocess.check_output(
            ["/opt/homebrew/bin/limactl", "list", "--json"], env=ENV, text=True, timeout=30
        ).splitlines()
    ]
    require(
        len(rows) == len(expected) and {row["name"] for row in rows} == expected,
        "Pool inventory is unknown or exceeds two owned guests",
    )
    for row in rows:
        if row["name"] == main_policy.BASE_VM:
            require(row["status"] == "Stopped", "Base is not stopped")
        else:
            config = row["config"]
            require(
                config["cpus"] == 6
                and config["memory"] == "12GiB"
                and config["disk"] == "60GiB"
                and config["arch"] == "aarch64"
                and config["plain"] is True
                and not config.get("mounts")
                and all(
                    config["ssh"][key] is False
                    for key in ("loadDotSSHPubKeys", "forwardAgent", "forwardX11", "forwardX11Trusted")
                )
                and config["containerd"]["system"] is False
                and config["containerd"]["user"] is False
                and config["propagateProxyEnv"] is False
                and config["hostResolver"]["enabled"] is False
                and not config.get("env")
                and not config.get("socketForwards")
                and all(item["ignore"] is True for item in config.get("portForwards", [])),
                "Active peer resources changed",
            )


def require_disposed_state(slot):
    path = slot / "evidence" / "session-state.json"
    if os.path.lexists(path):
        state = json.loads(read_private_file(path))
        require(
            state["state"] == "completed-and-disposed" and state.get("inspection_seen") is False,
            "Profile retains inspection or unresolved session state",
        )


def available_policies(config, active):
    if not require_known_pool(active):
        return {}
    require(configuration() == config, "Ongoing policy changed; no live reload")
    available = [profile for profile in PROFILES if profile not in active]
    for profile in available:
        ready_group(profile=profile)
    return queued_policies(config, available)


def read_private_file(path):
    require(path.parent.resolve() == path.parent, "Private parent is not canonical")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor) as stream:
        metadata = os.fstat(stream.fileno())
        require(
            stat.S_ISREG(metadata.st_mode)
            and metadata.st_uid == os.getuid()
            and stat.S_IMODE(metadata.st_mode) == 0o600
            and metadata.st_size <= 16384,
            "Private file requires owning user, mode600 and bounded size",
        )
        return stream.read(16385)


def load_host_credential():
    require(
        ROOT.resolve() == ROOT
        and ROOT.is_dir()
        and ROOT.stat().st_uid == os.getuid()
        and ROOT.stat().st_mode & 0o022 == 0,
        "Credential directory is not owned and protected",
    )
    token = read_private_file(ROOT / "host-gh-token").strip()
    require(0 < len(token) <= 16384 and not re.search(r"\s", token), "Host credential format is invalid")
    os.environ["GH_TOKEN"] = token
    ENV["GH_TOKEN"] = token


def require_dead_owner(pid):
    require(type(pid) is int and pid > 0, "Invalid retained owner PID")
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return
    raise RuntimeError("Retained owner PID is live or cannot be proved dead")


def reconcile_dead_idle_owner():
    require_local_idle()
    lock = ROOT / ".pool-lock"
    require(lock.resolve() == lock and lock.is_dir(), "Retained pool lock is not canonical")
    require(
        stat.S_IMODE(lock.stat().st_mode) == 0o700
        and lock.stat().st_uid == os.getuid()
        and {item.name for item in lock.iterdir()} == {"pid"},
        "Retained pool lock shape changed",
    )
    text = read_private_file(lock / "pid")
    require(re.fullmatch(r"[1-9][0-9]*\n", text) is not None, "Invalid retained PID record")
    pid = int(text)
    require_dead_owner(pid)
    state_path = ROOT / "evidence" / "ongoing-pool-state.json"
    state = json.loads(read_private_file(state_path))
    require(
        type(state.get("owner_pid")) is int
        and state["owner_pid"] == pid
        and state["state"] in ("waiting-for-reviewed-main-job", "job-disposed"),
        "Retained pool was not proved clean and idle",
    )
    config = idle_readback()
    require_stopped_base()
    gate = ROOT / ".reservation-lock"
    gate.mkdir(mode=0o700)
    try:
        require_running()
        require_dead_owner(pid)
        require(
            read_private_file(lock / "pid") == text and json.loads(read_private_file(state_path)) == state,
            "Retained ownership changed during readback",
        )
        for profile in ("scoped", "ordinary"):
            for name in (
                ".active-vm",
                ".active-registration.json",
                ".supervisor.pid",
                ".lifecycle-lock",
                ".registration-attempt.json",
                ".pending-job.json",
            ):
                require(not os.path.lexists(ROOT / "slots" / profile / name), "Profile changed during readback")
        require(idle_readback() == config, "Reviewed policy changed during dead-owner readback")
        require_stopped_base()
        require_dead_owner(pid)
        (lock / "pid").unlink()
        lock.rmdir()
        service_report("dead-idle-owner-reconciled", previous_owner_pid=pid)
    finally:
        gate.rmdir()


def daemon_start():
    try:
        load_host_credential()
        signal.signal(signal.SIGTERM, stop_requested)
        signal.signal(signal.SIGINT, stop_requested)
        if os.path.lexists(ROOT / ".pool-lock"):
            retry_idle_read(reconcile_dead_idle_owner)
        else:
            retry_idle_read(idle_readback)
        start()
    except PoolStopped:
        service_report("stopped")
    except Exception as error:
        service_report("blocked", error_type=type(error).__name__, reason=str(error))


def start():
    require(ROOT.resolve() == ROOT and STATE.resolve() == STATE, "Unexpected private pool path")
    lock = ROOT / ".pool-lock"
    lock.mkdir(mode=0o700)
    (lock / "pid").write_text(str(os.getpid()) + "\n")
    (lock / "pid").chmod(0o600)
    active = {}
    inspection_error = None
    successful = False
    try:
        signal.signal(signal.SIGTERM, stop_requested)
        signal.signal(signal.SIGINT, stop_requested)
        config = retry_idle_read(idle_readback)
        for profile in PROFILES:
            enable_idle_access(profile)
        next_read = 0
        while active or not STOP and not (ROOT / ".drain").exists():
            for profile, handle in list(active.items()):
                if handle["process"].poll() is None:
                    continue
                try:
                    complete_job(handle)
                    next_read = 0
                except Exception as error:
                    inspection_error = error
                    report("needs-inspection", profile=profile, error_type=type(error).__name__, reason=str(error))
                    if not (ROOT / ".drain").exists():
                        request_drain()
                del active[profile]
            if STOP and not (ROOT / ".drain").exists():
                request_drain()
            if inspection_error or STOP or (ROOT / ".drain").exists():
                if not active:
                    break
                time.sleep(5)
                continue
            if time.monotonic() >= next_read:
                try:
                    policies = available_policies(config, active)
                    next_read = time.monotonic() + 60
                except TransientReadError:
                    require_known_pool(active)
                    service_report("idle-read-retry", retry_seconds=30)
                    policies = {}
                    next_read = time.monotonic() + 30
                for profile, policy in policies.items():
                    require(profile not in active and policy.profile == profile, "Profile already has a controller")
                    try:
                        handle = prepare_job(config, policy)
                    except Exception as error:
                        inspection_error = error
                        report("needs-inspection", profile=profile, error_type=type(error).__name__, reason=str(error))
                        if not (ROOT / ".drain").exists():
                            request_drain()
                        break
                    if handle is not None:
                        active[profile] = handle
            if not active:
                report("waiting-for-reviewed-main-job")
            time.sleep(5)
        if STOP and not (ROOT / ".drain").exists():
            request_drain()
        if inspection_error:
            raise inspection_error
        require_local_idle_without_drain()
        for profile in PROFILES:
            close_group(None, profile=profile)
        report("drained")
        successful = True
    except Exception as error:
        if not (ROOT / ".drain").exists():
            request_drain()
        while active:
            for profile, handle in list(active.items()):
                if handle["process"].poll() is not None:
                    try:
                        complete_job(handle)
                    except Exception:
                        pass
                    del active[profile]
            if active:
                time.sleep(5)
        withdrawal_errors = {}
        for profile in PROFILES:
            try:
                withdraw_after_error(profile)
            except Exception as cleanup_error:
                withdrawal_errors[profile] = type(cleanup_error).__name__
        report(
            "needs-inspection", error_type=type(error).__name__, reason=str(error), withdrawal_errors=withdrawal_errors
        )
        raise
    finally:
        if successful:
            (lock / "pid").unlink()
            lock.rmdir()


def require_local_idle_without_drain():
    require(not os.path.lexists(ROOT / ".reservation-lock"), "Pool reservation remains")
    for name in (".active-vm", ".active-registration.json", ".supervisor.pid", ".lifecycle-lock"):
        require(not os.path.lexists(ROOT / name), "Global pool guard remains: " + name)
    for profile in PROFILES:
        require_clean_slot(profile)
    require_stopped_base()


def resume():
    require(not (ROOT / ".pool-lock").exists(), "Ongoing supervisor or inspection lock remains")
    gate = ROOT / ".reservation-lock"
    gate.mkdir(mode=0o700)
    try:
        configuration()
        for profile in PROFILES:
            for name in (
                ".active-vm",
                ".active-registration.json",
                ".supervisor.pid",
                ".lifecycle-lock",
                ".registration-attempt.json",
                ".pending-job.json",
            ):
                require(not (ROOT / "slots" / profile / name).exists(), "Profile is not reconciled")
            idle_group(profile=profile)
        inventory = subprocess.check_output(
            ["/opt/homebrew/bin/limactl", "list", "--json"], env=ENV, text=True, timeout=30
        )
        rows = [json.loads(line) for line in inventory.splitlines()]
        require(
            len(rows) == 1 and rows[0]["name"] == main_policy.BASE_VM and rows[0]["status"] == "Stopped",
            "Resume found unresolved guest inventory",
        )
        (ROOT / ".drain").unlink(missing_ok=True)
        report("resume-approved")
    finally:
        gate.rmdir()


def main():
    os.umask(0o077)
    require(
        len(sys.argv) == 2 and sys.argv[1] in ("start", "daemon-start", "status", "resume", "drain"),
        "Use start, daemon-start, status, resume or drain",
    )
    if sys.argv[1] == "start":
        start()
    elif sys.argv[1] == "daemon-start":
        daemon_start()
    elif sys.argv[1] == "resume":
        resume()
    elif sys.argv[1] == "drain":
        request_drain()
    else:
        path = ROOT / "evidence" / "ongoing-pool-state.json"
        print(path.read_text() if path.exists() else json.dumps({"state": "not-installed"}))


if __name__ == "__main__":
    main()
