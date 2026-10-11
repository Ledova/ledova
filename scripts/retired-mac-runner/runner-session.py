#!/usr/bin/env python3
import datetime
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time

import pool_reservation
import runner_main_policy as main_policy

task_program_root = pathlib.Path(os.environ["LEDOVA_MANUAL_RUNNER_ROOT"])
task_profiles = main_policy.PROFILES
if len(sys.argv) != 2 or sys.argv[1] not in task_profiles:
    raise RuntimeError("An exact scoped or ordinary profile is required")
task_profile = sys.argv[1]
task_group_id, task_group_name, task_prefix = task_profiles[task_profile]
task_root = task_program_root / "slots" / task_profile
if task_program_root.resolve() != task_program_root or task_root.resolve() != task_root:
    raise RuntimeError("Unexpected host or profile path")


def require(task_condition, task_message):
    if not task_condition:
        raise RuntimeError(task_message)


task_receipt_path = task_root / ".active-registration.json"
task_receipt = json.loads(task_receipt_path.read_text())
task_vm = task_receipt["vm"]
require(re.fullmatch(task_prefix + r"-[0-9a-f]{12}", task_vm), "Unexpected VM name")
require(task_receipt["profile"] == task_profile, "Profile receipt mismatch")
require(task_receipt["resources"] == {"cpus": 6, "memory_gib": 12, "disk_gib": 60}, "Unexpected resource policy")
require((task_root / ".active-vm").read_text().strip() == task_vm, "VM receipt mismatch")
require(task_receipt["group_id"] == task_group_id, "Unexpected group")
require(task_receipt["ephemeral"] is True, "One-job registration required")
task_policy = task_receipt.get("access_policy")
task_main_policy = None
if task_policy is not None:
    require(task_policy.get("mode") == "ongoing-main", "Unsupported ongoing policy")
    task_main_policy = main_policy.policy_from_receipt(task_policy)
    require(task_main_policy.profile == task_profile, "Main job belongs to another profile")
    require(task_policy["max_jobs"] == 1 and task_policy["timeout_minutes"] == 130, "Unexpected execution bounds")
    require(re.fullmatch(r"[0-9a-f]{40}", task_policy["sha"]), "Invalid reviewed SHA")
    require(re.fullmatch(r"[0-9a-f]{40}", task_policy["tree"]), "Invalid reviewed tree")
task_runner_id = int(task_receipt["runner_id"])
require(task_runner_id > 0, "Invalid runner ID")
task_env = os.environ.copy()
task_env["LIMA_HOME"] = str(task_program_root / "lima")
task_env["LEDOVA_SESSION_OWNER_PID"] = str(os.getpid())
task_lock = task_root / ".lifecycle-lock"
task_evidence = task_root / "evidence" / task_vm
task_evidence.mkdir(mode=0o700, exist_ok=True)
task_deadline = datetime.datetime.fromisoformat(task_receipt["idle_deadline"]).timestamp()
task_stop_requested = False
task_closing_access = False
task_inspection_seen = False
task_job_cancelled_before_start = False


def report(task_message):
    print(datetime.datetime.now(datetime.timezone.utc).isoformat(), task_message, flush=True)


def api(task_path, task_method="GET"):
    task_result = subprocess.run(
        ["gh", "api", "--method", task_method, task_path], text=True, capture_output=True, timeout=30
    )
    if task_result.returncode:
        if task_method == "GET" and "(HTTP 404)" in task_result.stderr:
            return None
        raise RuntimeError("GitHub API verification failed for " + task_path)
    return json.loads(task_result.stdout) if task_result.stdout.strip() else None


def identity():
    task_runner = api(f"orgs/Ledova/actions/runners/{task_runner_id}")
    if task_runner is not None:
        require(task_runner["id"] == task_runner_id, "Runner ID mismatch")
        require(task_runner["name"] == task_receipt["runner_name"], "Runner name mismatch")
        require(task_receipt["label"] == task_group_name, "Unexpected custom label")
        require(task_runner["os"].casefold() == "linux", "Runner OS mismatch")
        require(
            {"self-hosted", "Linux", "ARM64", task_receipt["label"]}
            <= {item["name"] for item in task_runner["labels"]},
            "Runner label mismatch",
        )
        if task_main_policy is not None:
            require(
                set(task_main_policy.as_receipt()["requested_labels"])
                <= {item["name"] for item in task_runner["labels"]},
                "Exact run/job labels missing",
            )
    return task_runner


def group_policy():
    task_group = api(f"orgs/Ledova/actions/runner-groups/{task_group_id}")
    task_repos = api(f"orgs/Ledova/actions/runner-groups/{task_group_id}/repositories")
    require(task_group["id"] == task_group_id, "Group ID mismatch")
    require(task_group["name"] == task_group_name, "Group name mismatch")
    require(task_group["default"] is False and task_group["inherited"] is False, "Group ownership changed")
    require(task_group["visibility"] == "selected", "Group visibility changed")
    task_repository_set = {(item["id"], item["full_name"]) for item in task_repos["repositories"]}
    if task_repos["total_count"] == 0 and not task_repository_set:
        require(task_group["allows_public_repositories"] is False, "Empty group public access changed")
        return "closed"
    require(task_policy is not None, "Dormant session cannot accept repository access")
    require(
        task_repos["total_count"] == 1 and task_repository_set == {(main_policy.REPOSITORY_ID, main_policy.REPOSITORY)},
        "Repository access changed",
    )
    require(task_group["allows_public_repositories"] is True, "Required public access missing")
    require(task_group["restricted_to_workflows"] is True, "Workflow restriction missing")
    require(task_group["selected_workflows"] == [task_policy["workflow"]], "Workflow access changed")
    return "active"


def reviewed_source():
    global task_job_cancelled_before_start
    if task_main_policy is not None:
        task_run = api(f"repos/Ledova/ledova/actions/runs/{task_main_policy.run_id}")
        task_attempt = api(
            f"repos/Ledova/ledova/actions/runs/{task_main_policy.run_id}/attempts/{task_main_policy.run_attempt}"
        )
        task_job_record = api(f"repos/Ledova/ledova/actions/jobs/{task_main_policy.job_id}")
        task_commit = api("repos/Ledova/ledova/git/commits/" + task_main_policy.sha)
        task_definition = api("repos/Ledova/ledova/contents/.github/workflows/ci.yml?ref=" + task_main_policy.sha)
        main_policy.assert_policy_unchanged(
            task_main_policy,
            run=task_run,
            attempt=task_attempt,
            job=task_job_record,
            commit=task_commit,
            workflow_definition=task_definition,
        )
        task_job_cancelled_before_start = (
            task_job_record["status"] == "completed"
            and task_job_record["conclusion"] in ("cancelled", "skipped")
            and task_job_record.get("runner_id") in (None, 0)
        )
        if task_job_record["status"] != "queued" and not task_job_cancelled_before_start:
            require(
                task_job_record["runner_id"] == task_runner_id
                and task_job_record["runner_name"] == task_receipt["runner_name"]
                and task_job_record["runner_group_id"] == task_group_id,
                "Actual job assignment differs from owned receipt",
            )
        return task_job_record
    raise RuntimeError("Reviewed source requires an ongoing policy")


def access_check():
    task_state = group_policy()
    task_job_record = None
    if task_policy is not None:
        task_job_record = reviewed_source()
    task_members = api(f"orgs/Ledova/actions/runner-groups/{task_group_id}/runners")
    task_runner = identity()
    if task_main_policy is not None and task_runner is None:
        task_job_record = reviewed_source()
        require(task_job_record["status"] == "completed", "Owned runner missing before the exact job completed")
        task_members = api(f"orgs/Ledova/actions/runner-groups/{task_group_id}/runners")
        require(
            task_members["total_count"] == 0 and not task_members["runners"], "Completed group has a foreign runner"
        )
        return task_state
    require(
        task_members["total_count"] == 1 and {item["id"] for item in task_members["runners"]} == {task_runner_id},
        "Runner group membership changed",
    )
    require(task_runner is not None, "Owned runner missing")
    return task_state


def closing_snapshot():
    task_group = api(f"orgs/Ledova/actions/runner-groups/{task_group_id}")
    task_repos = api(f"orgs/Ledova/actions/runner-groups/{task_group_id}/repositories")
    require(
        task_group["id"] == task_group_id and task_group["name"] == task_group_name, "Closing group identity changed"
    )
    require(
        task_group["default"] is False and task_group["inherited"] is False and task_group["visibility"] == "selected",
        "Closing group ownership changed",
    )
    require(
        task_group["restricted_to_workflows"] is True and task_group["selected_workflows"] == [task_policy["workflow"]],
        "Closing workflow policy changed",
    )
    task_repository_set = {(item["id"], item["full_name"]) for item in task_repos["repositories"]}
    require(
        task_repos["total_count"] == len(task_repository_set)
        and task_repository_set <= {(main_policy.REPOSITORY_ID, main_policy.REPOSITORY)},
        "Closing repository policy changed",
    )
    return task_group, task_repository_set


def close_access():
    global task_closing_access
    if not task_closing_access:
        if group_policy() == "closed":
            return
        task_closing_access = True
    task_group, task_repository_set = closing_snapshot()
    if task_repository_set:
        api(f"orgs/Ledova/actions/runner-groups/{task_group_id}/repositories/{main_policy.REPOSITORY_ID}", "DELETE")
    task_group, task_repository_set = closing_snapshot()
    require(not task_repository_set, "Repository withdrawal unconfirmed")
    if task_group["allows_public_repositories"]:
        task_body = json.dumps(
            {
                "name": task_group_name,
                "allows_public_repositories": False,
                "restricted_to_workflows": True,
                "selected_workflows": [task_policy["workflow"]],
            }
        )
        task_result = subprocess.run(
            ["gh", "api", "--method", "PATCH", f"orgs/Ledova/actions/runner-groups/{task_group_id}", "--input", "-"],
            input=task_body,
            text=True,
            capture_output=True,
            timeout=30,
        )
        require(task_result.returncode == 0, "Public access withdrawal failed")
    task_group, task_repository_set = closing_snapshot()
    require(
        not task_repository_set and task_group["allows_public_repositories"] is False, "Closed access readback failed"
    )


def guest(task_command, **task_options):
    return subprocess.run(
        [
            "/opt/homebrew/bin/limactl",
            "shell",
            "--tty=false",
            "--workdir",
            "/opt/actions-runner",
            task_vm,
            "bash",
            "-lc",
            task_command,
        ],
        env=task_env,
        check=True,
        **task_options,
    )


def guest_admission():
    task_result = subprocess.run(
        ["/opt/homebrew/bin/limactl", "list", "--json"],
        env=task_env,
        text=True,
        capture_output=True,
        check=True,
        timeout=30,
    )
    task_rows = [json.loads(line) for line in task_result.stdout.splitlines()]
    task_matches = [row for row in task_rows if row["name"] == task_vm]
    require(len(task_matches) == 1, "Owned guest configuration missing")
    task_row = task_matches[0]
    task_config = task_row["config"]
    require(
        task_row["status"] == "Running"
        and task_config["cpus"] == 6
        and task_config["memory"] == "12GiB"
        and task_config["disk"] == "60GiB"
        and task_config["arch"] == "aarch64"
        and task_config["plain"] is True
        and not task_config.get("mounts")
        and not task_config.get("socketForwards")
        and not task_config.get("env")
        and task_config["ssh"]["loadDotSSHPubKeys"] is False
        and task_config["ssh"]["forwardAgent"] is False
        and task_config["ssh"]["forwardX11"] is False
        and task_config["ssh"]["forwardX11Trusted"] is False
        and task_config["containerd"]["system"] is False
        and task_config["containerd"]["user"] is False
        and task_config["propagateProxyEnv"] is False
        and task_config["hostResolver"]["enabled"] is False
        and all(item["ignore"] is True for item in task_config.get("portForwards", [])),
        "Owned guest resource or isolation configuration changed",
    )
    task_result = guest(
        'set -e; test -z "$(pgrep -x Runner.Listener || true)"; '
        'test -z "$(pgrep -x Runner.Worker || true)"; '
        "jq -c '{agentId,agentName,poolId,poolName,ephemeral,gitHubUrl,workFolder}' .runner",
        text=True,
        capture_output=True,
        timeout=30,
    )
    task_settings = json.loads(task_result.stdout.lstrip("\ufeff"))
    require(
        task_settings["agentId"] == task_runner_id
        and task_settings["agentName"] == task_receipt["runner_name"]
        and task_settings["poolId"] == task_group_id
        and task_settings["poolName"] == task_group_name
        and task_settings["ephemeral"] is True
        and task_settings["gitHubUrl"] == "https://github.com/Ledova"
        and task_settings["workFolder"] == "_work",
        "Guest registration differs from owned one-job receipt",
    )


def request_stop(task_signal, task_frame):
    global task_stop_requested
    task_stop_requested = True


def cleanup_access():
    if (
        task_main_policy is not None
        and not task_stop_requested
        and not task_inspection_seen
        and not (task_program_root / ".drain").exists()
        and time.time() < task_deadline
    ):
        task_job_record = reviewed_source()
        if task_job_record["status"] == "completed":
            require(access_check() == "active", "Clean turnover requires exact permanent eligibility")
            if (
                not task_stop_requested
                and not task_inspection_seen
                and not (task_program_root / ".drain").exists()
                and time.time() < task_deadline
            ):
                return "active"
    close_access()
    require(group_policy() == "closed", "Stopped cleanup requires verified closed access")
    return "closed"


def stop_idle(task_output):
    cleanup_access()
    task_runner = identity()
    if task_runner is not None and task_runner["busy"]:
        return False
    task_result = subprocess.run(
        [
            "/opt/homebrew/bin/limactl",
            "shell",
            "--tty=false",
            "--workdir",
            "/opt/actions-runner",
            task_vm,
            "bash",
            "-lc",
            "set -e; if pgrep -x Runner.Worker >/dev/null; then exit 61; fi; "
            'task_pids="$(pgrep -x Runner.Listener || true)"; '
            'if test -n "$task_pids"; then '
            'test "$(printf "%s\\n" "$task_pids" | wc -l)" -eq 1; '
            'kill -INT "$task_pids"; fi',
        ],
        env=task_env,
        stdout=task_output,
        stderr=task_output,
        timeout=30,
    )
    if task_result.returncode == 61:
        return False
    require(task_result.returncode == 0, "Owned guest idle probe failed")
    if task_process is not None:
        task_process.wait(timeout=60)
    return True


def inspection(task_stage, task_error):
    global task_inspection_seen
    task_inspection_seen = True
    (task_root / "evidence" / "session-state.json").write_text(
        json.dumps(
            {
                "state": "needs-inspection",
                "runner_id": task_runner_id,
                "stage": task_stage,
                "error_type": type(task_error).__name__,
            },
            indent=2,
        )
        + "\n"
    )
    task_reason = str(task_error)
    if task_reason not in {
        "Runner group membership changed",
        "Owned runner missing",
        "Completed group has a foreign runner",
        "Owned runner missing before the exact job completed",
    }:
        task_reason = "Unclassified verification failure"
    report(
        "Inspection needed at "
        + task_stage
        + "; check: "
        + task_reason
        + "; retaining the owned state and supervising."
    )


def verify_listener_exit():
    global task_stop_requested
    if (
        task_main_policy is None
        or task_process is None
        or task_stop_requested
        or (task_program_root / ".drain").exists()
        or time.time() >= task_deadline
    ):
        return
    task_job_record = reviewed_source()
    if not task_job_cancelled_before_start and (
        task_process.returncode != 0 or task_job_record["status"] != "completed"
    ):
        inspection("unexpected-listener-exit", RuntimeError("Listener exited without clean terminal job proof"))
        task_stop_requested = True


signal.signal(signal.SIGTERM, request_stop)
signal.signal(signal.SIGINT, request_stop)
os.umask(0o077)
task_lock.mkdir(mode=0o700)
(task_root / ".supervisor.pid").write_text(str(os.getpid()) + "\n")
task_stage = "before-listener"
task_process = None
try:
    task_access_state = access_check()
    if task_main_policy is not None:
        require(
            task_access_state == "active" or task_job_cancelled_before_start or (task_program_root / ".drain").exists(),
            "Ongoing listener requires completed access grant",
        )
    guest_admission()
    task_runner = identity()
    require(task_runner is not None and task_runner["busy"] is False, "Runner is absent or busy")
    task_members = api(f"orgs/Ledova/actions/runner-groups/{task_group_id}/runners")
    require(any(item["id"] == task_runner_id for item in task_members["runners"]), "Runner group membership mismatch")
    with (task_evidence / "listener.log").open("ab", buffering=0) as task_output:
        task_reservation = pool_reservation.wait_acquire(task_program_root, task_profile, "listener", os.getpid())
        task_previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
        try:
            task_pending_stop = bool(signal.sigpending() & {signal.SIGTERM, signal.SIGINT})
            if (
                task_stop_requested
                or task_pending_stop
                or task_job_cancelled_before_start
                or (task_program_root / ".drain").exists()
                or time.time() >= task_deadline
            ):
                report("Session stopping before listener admission; cleaning the idle owned registration.")
            else:
                task_process = subprocess.Popen(
                    [
                        "/opt/homebrew/bin/limactl",
                        "shell",
                        "--tty=false",
                        "--workdir",
                        "/opt/actions-runner",
                        task_vm,
                        "env",
                        "AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache",
                        "./run.sh",
                    ],
                    env=task_env,
                    stdin=subprocess.DEVNULL,
                    stdout=task_output,
                    stderr=task_output,
                    preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, task_previous_mask),
                )
                report(f"Owned listener started for runner {task_runner_id}; bounded access policy verified.")
        finally:
            pool_reservation.release(task_program_root, task_reservation)
            signal.pthread_sigmask(signal.SIG_SETMASK, task_previous_mask)
        task_stage = "supervision"
        task_next_access_check = 0
        while task_process is not None and task_process.poll() is None:
            try:
                if time.time() >= task_next_access_check:
                    access_check()
                    task_next_access_check = time.time() + 60
                if (
                    task_stop_requested
                    or task_job_cancelled_before_start
                    or (task_program_root / ".drain").exists()
                    or time.time() >= task_deadline
                ):
                    cleanup_access()
                    task_runner = identity()
                    if task_runner is not None and task_runner["busy"]:
                        report("Owned runner is busy; waiting for completion without cancellation.")
                        time.sleep(5)
                        continue
                    if stop_idle(task_output):
                        break
            except Exception as task_error:
                inspection("supervision", task_error)
                task_stop_requested = True
                try:
                    if stop_idle(task_output):
                        break
                except Exception as task_probe_error:
                    inspection("guest-idle-probe", task_probe_error)
                time.sleep(30)
                continue
            time.sleep(5)
        verify_listener_exit()
        task_stage = "registration-removal"
        while True:
            try:
                if not stop_idle(task_output):
                    time.sleep(30)
                    continue
                guest(
                    'set -e; test -z "$(pgrep -x Runner.Listener || true)"; '
                    'test -z "$(pgrep -x Runner.Worker || true)"',
                    stdout=task_output,
                    stderr=task_output,
                    timeout=30,
                )
                cleanup_access()
                task_runner = identity()
                if task_runner is not None:
                    require(task_runner["busy"] is False, "Registration remains busy")
                    api(f"orgs/Ledova/actions/runners/{task_runner_id}", "DELETE")
                    require(identity() is None, "Registration removal unconfirmed")
                break
            except Exception as task_error:
                inspection("registration-removal", task_error)
                time.sleep(30)
    task_receipt["completed_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (task_evidence / "registration-completed.json").write_text(json.dumps(task_receipt, indent=2) + "\n")
    task_receipt_path.unlink()
    task_lock.rmdir()
    task_stage = "vm-disposal"
    task_env["LEDOVA_SESSION_INSPECTION_SEEN"] = "true" if task_inspection_seen else "false"
    subprocess.run(
        [str(task_program_root / "runner-host"), "discard", task_profile],
        check=True,
        env=task_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    require(
        json.loads((task_root / "evidence" / "session-state.json").read_text())
        == {
            "state": "completed-and-disposed",
            "runner_id": task_runner_id,
            "controller_pid": os.getpid(),
            "inspection_seen": task_inspection_seen,
        },
        "Disposal state handoff changed",
    )
    report("Owned registration removed, diagnostics retained, and clone disposed of.")
except Exception as task_error:
    inspection(task_stage, task_error)
    report("Controller ended; inspect its actual cleanup stage and retained evidence.")
    raise
