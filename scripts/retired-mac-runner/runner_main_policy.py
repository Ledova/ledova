import base64
import binascii
import hashlib
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

REPOSITORY_ID = int(os.environ["LEDOVA_MANUAL_REPOSITORY_ID"])
REPOSITORY = "Ledova/ledova"
WORKFLOW_PATH = ".github/workflows/ci.yml"
WORKFLOW = REPOSITORY + "/" + WORKFLOW_PATH + "@refs/heads/main"
PROFILES = {
    "scoped": (int(os.environ["LEDOVA_MANUAL_SCOPED_GROUP_ID"]), os.environ["LEDOVA_MANUAL_SCOPED_GROUP_NAME"], "s"),
    "ordinary": (
        int(os.environ["LEDOVA_MANUAL_ORDINARY_GROUP_ID"]),
        os.environ["LEDOVA_MANUAL_ORDINARY_GROUP_NAME"],
        "o",
    ),
}
BASE_VM = os.environ["LEDOVA_MANUAL_BASE_VM"]
if (
    REPOSITORY_ID < 1
    or any(
        group_id < 1 or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", label) is None
        for group_id, label, _ in PROFILES.values()
    )
    or len({profile[0] for profile in PROFILES.values()}) != 2
    or len({profile[1] for profile in PROFILES.values()}) != 2
    or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", BASE_VM) is None
):
    raise ValueError("Explicit positive repository and distinct safe manual runner groups/base are required")
MAC_JOBS = {
    "checks": ("Source and client checks", "ordinary"),
    "backend": ("Backend verification", "scoped"),
}
API_ROOT = "https://api.github.com/repos/" + REPOSITORY
RUN_PATHS = {WORKFLOW_PATH, WORKFLOW_PATH + "@main", WORKFLOW_PATH + "@refs/heads/main"}
CONCLUSIONS = {
    "success",
    "failure",
    "neutral",
    "cancelled",
    "skipped",
    "timed_out",
    "action_required",
    "stale",
    "startup_failure",
}


class PolicyError(ValueError):
    pass


def _require(condition, message):
    if not condition:
        raise PolicyError(message)


def _object(value, name):
    _require(isinstance(value, Mapping), name + " must be an API object")
    return value


def _id(value, name):
    _require(type(value) is int and value > 0, name + " must be a positive integer")
    return value


def _sha(value, name):
    _require(
        type(value) is str and re.fullmatch(r"[0-9a-f]{40}", value) is not None, name + " must be a full lowercase SHA"
    )
    return value


@dataclass(frozen=True)
class MainJobPolicy:
    run_id: int
    run_attempt: int
    job_id: int
    sha: str
    tree: str
    event: str
    workflow_id: int
    workflow_blob_sha: str
    reviewed_delivery_sha: str
    main_observed_sha: str
    job: str = "backend"

    def __post_init__(self):
        _require(type(self.job) is str and self.job in MAC_JOBS, "Unsupported main Mac job")
        for name in ("run_id", "run_attempt", "job_id", "workflow_id"):
            _id(getattr(self, name), name)
        for name in ("sha", "tree", "workflow_blob_sha", "reviewed_delivery_sha", "main_observed_sha"):
            _sha(getattr(self, name), name)
        _require(type(self.event) is str and self.event in {"push", "workflow_dispatch"}, "Unsupported event")

    @property
    def dynamic_label(self):
        return f"ledova-main-{self.run_id}-{self.run_attempt}"

    @property
    def profile(self):
        return MAC_JOBS[self.job][1]

    @property
    def group_id(self):
        return PROFILES[self.profile][0]

    @property
    def profile_label(self):
        return PROFILES[self.profile][1]

    @property
    def job_label(self):
        return "ledova-job-" + self.job

    def as_receipt(self):
        return {
            "mode": "ongoing-main",
            "profile": self.profile,
            "group_id": self.group_id,
            "job": self.job,
            "api_job_name": MAC_JOBS[self.job][0],
            "repository_id": REPOSITORY_ID,
            "repository": REPOSITORY,
            "workflow": WORKFLOW,
            "ref": "refs/heads/main",
            "run_id": self.run_id,
            "run_attempt": self.run_attempt,
            "job_id": self.job_id,
            "sha": self.sha,
            "tree": self.tree,
            "event": self.event,
            "workflow_id": self.workflow_id,
            "workflow_blob_sha": self.workflow_blob_sha,
            "reviewed_delivery_sha": self.reviewed_delivery_sha,
            "main_observed_sha": self.main_observed_sha,
            "dynamic_label": self.dynamic_label,
            "requested_labels": [self.profile_label, self.dynamic_label, self.job_label],
            "max_jobs": 1,
            "timeout_minutes": 130,
        }


def policy_from_receipt(receipt):
    receipt = _object(receipt, "Policy receipt")
    field_names = MainJobPolicy.__dataclass_fields__
    _require(set(field_names) <= receipt.keys(), "Policy receipt fields missing")
    policy = MainJobPolicy(**{name: receipt[name] for name in field_names})
    expected = policy.as_receipt()
    _require(receipt.keys() == expected.keys(), "Unexpected policy receipt fields")
    for name, value in expected.items():
        _require(
            type(receipt[name]) is type(value) and receipt[name] == value, "Noncanonical policy receipt field: " + name
        )
    return policy


def _run_context(raw, *, run_id, run_attempt, sha, tree, event, workflow_id, queued, allow_newer_attempt=False):
    raw = _object(raw, "Workflow run")
    _require(_id(raw.get("id"), "Run ID") == run_id, "Run identity changed")
    actual_attempt = _id(raw.get("run_attempt"), "Run attempt")
    _require(
        actual_attempt == run_attempt or allow_newer_attempt and actual_attempt > run_attempt, "Run attempt changed"
    )
    _require(raw.get("head_sha") == sha and raw.get("head_branch") == "main", "Run source changed or is not main")
    if raw.get("head_commit") is not None:
        head_commit = _object(raw["head_commit"], "Run head commit")
        _require(head_commit.get("id") == sha, "Run head commit differs")
        if "tree_id" in head_commit:
            _require(head_commit["tree_id"] == tree, "Run head tree differs")
    _require(
        raw.get("event") == event and event in {"push", "workflow_dispatch"},
        "Run event changed or is not trusted main execution",
    )
    _require(
        _id(raw.get("workflow_id"), "Workflow ID") == workflow_id
        and type(raw.get("path")) is str
        and raw["path"] in RUN_PATHS,
        "Workflow identity changed",
    )
    for name in ("repository", "head_repository"):
        repo = _object(raw.get(name), name)
        _require(
            _id(repo.get("id"), name + " ID") == REPOSITORY_ID
            and repo.get("full_name") == REPOSITORY
            and repo.get("fork") is False,
            "Run repository is unknown or a fork",
        )
    _require(
        type(raw.get("pull_requests")) is list and not raw["pull_requests"], "Pull request context is not permitted"
    )
    _require(raw.get("referenced_workflows", []) == [], "Unexpected reusable workflow")
    allowed = {"queued", "in_progress"} if queued else {"queued", "in_progress", "completed"}
    _require(type(raw.get("status")) is str and raw["status"] in allowed, "Unexpected run state")
    if raw["status"] == "completed":
        _require(
            type(raw.get("conclusion")) is str and raw["conclusion"] in CONCLUSIONS, "Completed run verdict missing"
        )
    else:
        _require("conclusion" in raw and raw["conclusion"] is None, "Unfinished run has a verdict")
    return raw


def _job_context(raw, policy, *, queued, unassigned=False):
    raw = _object(raw, "Workflow job")
    _require(
        _id(raw.get("id"), "Job ID") == policy.job_id
        and _id(raw.get("run_id"), "Job run ID") == policy.run_id
        and _id(raw.get("run_attempt"), "Job attempt") == policy.run_attempt,
        "Job identity or attempt changed",
    )
    _require(
        raw.get("head_sha") == policy.sha and raw.get("name") == MAC_JOBS[policy.job][0],
        "Unexpected job source or name",
    )
    if "head_branch" in raw:
        _require(raw["head_branch"] == "main", "Job is not on main")
    labels = raw.get("labels")
    _require(
        type(labels) is list
        and all(type(label) is str for label in labels)
        and len(labels) == 3
        and set(labels) == {policy.profile_label, policy.dynamic_label, policy.job_label},
        "Unexpected requested job labels",
    )
    allowed = {"queued"} if queued else {"queued", "in_progress", "completed"}
    _require(type(raw.get("status")) is str and raw["status"] in allowed, "Unexpected job state")
    if raw["status"] == "completed":
        _require(
            type(raw.get("conclusion")) is str and raw["conclusion"] in CONCLUSIONS, "Completed job verdict missing"
        )
    else:
        _require("conclusion" in raw and raw["conclusion"] is None, "Unfinished job has a verdict")
    if queued or unassigned:
        _require(
            "runner_id" in raw
            and (raw["runner_id"] is None or type(raw["runner_id"]) is int and raw["runner_id"] == 0),
            "Queued job is already assigned",
        )
        _require("runner_name" in raw and raw["runner_name"] in (None, ""), "Queued job already has a runner name")
        group_id = raw.get("runner_group_id")
        _require(
            group_id is None or type(group_id) is int and group_id in (0, policy.group_id),
            "Queued job has a different runner group",
        )
        _require(
            raw.get("runner_group_name") in (None, "", policy.profile_label),
            "Queued job has a different runner group name",
        )


def _commit_context(commit, policy):
    commit = _object(commit, "Git commit")
    tree = _object(commit.get("tree"), "Commit tree")
    _require(commit.get("sha") == policy.sha and tree.get("sha") == policy.tree, "Immutable commit/tree changed")


def _workflow_context(definition, policy):
    definition = _object(definition, "Workflow contents")
    _require(
        definition.get("type") == "file"
        and definition.get("path") == WORKFLOW_PATH
        and definition.get("sha") == policy.workflow_blob_sha,
        "Workflow file/blob is not the reviewed definition",
    )
    url = definition.get("url")
    _require(type(url) is str, "Workflow contents URL missing")
    try:
        parsed = urlsplit(url)
        query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError as error:
        raise PolicyError("Invalid workflow contents URL") from error
    _require(
        parsed.scheme == "https"
        and parsed.netloc == "api.github.com"
        and parsed.path == "/repos/" + REPOSITORY + "/contents/" + WORKFLOW_PATH
        and not parsed.fragment
        and query == [("ref", policy.sha)],
        "Workflow contents were not fetched at the captured source",
    )
    _require(
        definition.get("encoding") == "base64" and type(definition.get("content")) is str, "Workflow contents missing"
    )
    try:
        content = base64.b64decode(definition["content"].replace("\n", ""), validate=True)
    except (ValueError, binascii.Error) as error:
        raise PolicyError("Invalid workflow contents encoding") from error
    _require(type(definition.get("size")) is int and definition["size"] == len(content), "Workflow file size differs")
    blob = hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()
    _require(blob == policy.workflow_blob_sha, "Workflow bytes differ from the reviewed blob")


def _ancestor(comparison, base, head):
    comparison = _object(comparison, "Commit comparison")
    _require(
        comparison.get("url") == API_ROOT + "/compare/" + base + "..." + head,
        "Comparison is not bound to the requested immutable endpoints",
    )
    _require(
        _object(comparison.get("base_commit"), "Comparison base").get("sha") == base
        and _object(comparison.get("merge_base_commit"), "Comparison merge base").get("sha") == base,
        "Reviewed source is not an ancestor",
    )
    ahead = comparison.get("ahead_by")
    behind = comparison.get("behind_by")
    total = comparison.get("total_commits")
    _require(
        type(ahead) is int
        and ahead >= 0
        and type(behind) is int
        and behind == 0
        and type(total) is int
        and total == ahead,
        "Invalid ancestry counts",
    )
    if base == head:
        _require(comparison.get("status") == "identical" and ahead == 0, "Identical ancestry is unconfirmed")
    else:
        _require(
            comparison.get("status") == "ahead" and ahead > 0,
            "Source is before or divergent from the approved ancestor",
        )


def build_queued_policy(
    *,
    run,
    attempt,
    job,
    commit,
    main_ref,
    main_comparison,
    delivery_comparison,
    workflow_definition,
    reviewed_delivery_sha,
    approved_workflow_blob_sha,
    approved_workflow_id,
):
    run = _object(run, "Workflow run")
    attempt = _object(attempt, "Workflow attempt")
    job = _object(job, "Workflow job")
    commit = _object(commit, "Git commit")
    main_ref = _object(main_ref, "Main ref")
    ref_object = _object(main_ref.get("object"), "Main ref object")
    _require(
        main_ref.get("ref") == "refs/heads/main" and ref_object.get("type") == "commit", "Main ref is not a commit"
    )
    finished_unassigned = (
        job.get("status") == "completed"
        and type(job.get("conclusion")) is str
        and job["conclusion"] in {"cancelled", "skipped"}
    )
    policy = MainJobPolicy(
        run_id=_id(run.get("id"), "Run ID"),
        run_attempt=_id(attempt.get("run_attempt"), "Captured run attempt"),
        job_id=_id(job.get("id"), "Job ID"),
        sha=_sha(run.get("head_sha"), "Run SHA"),
        tree=_sha(_object(commit.get("tree"), "Commit tree").get("sha"), "Tree SHA"),
        event=run.get("event"),
        workflow_id=_id(approved_workflow_id, "Approved workflow ID"),
        workflow_blob_sha=_sha(approved_workflow_blob_sha, "Approved workflow blob"),
        reviewed_delivery_sha=_sha(reviewed_delivery_sha, "Reviewed delivery SHA"),
        main_observed_sha=_sha(ref_object.get("sha"), "Observed main SHA"),
        job=next((slug for slug, (name, _) in MAC_JOBS.items() if name == job.get("name")), ""),
    )
    _run_context(
        run,
        run_id=policy.run_id,
        run_attempt=policy.run_attempt,
        sha=policy.sha,
        tree=policy.tree,
        event=policy.event,
        workflow_id=policy.workflow_id,
        queued=not finished_unassigned,
        allow_newer_attempt=finished_unassigned,
    )
    _run_context(
        attempt,
        run_id=policy.run_id,
        run_attempt=policy.run_attempt,
        sha=policy.sha,
        tree=policy.tree,
        event=policy.event,
        workflow_id=policy.workflow_id,
        queued=not finished_unassigned,
    )
    _job_context(job, policy, queued=not finished_unassigned, unassigned=True)
    _commit_context(commit, policy)
    _workflow_context(workflow_definition, policy)
    _ancestor(delivery_comparison, policy.reviewed_delivery_sha, policy.sha)
    _ancestor(main_comparison, policy.sha, policy.main_observed_sha)
    if finished_unassigned:
        return None
    return policy


def assert_policy_unchanged(policy, *, run, attempt, job, commit, workflow_definition):
    _require(isinstance(policy, MainJobPolicy), "Validated main policy required")
    _run_context(
        run,
        run_id=policy.run_id,
        run_attempt=policy.run_attempt,
        sha=policy.sha,
        tree=policy.tree,
        event=policy.event,
        workflow_id=policy.workflow_id,
        queued=False,
        allow_newer_attempt=True,
    )
    _run_context(
        attempt,
        run_id=policy.run_id,
        run_attempt=policy.run_attempt,
        sha=policy.sha,
        tree=policy.tree,
        event=policy.event,
        workflow_id=policy.workflow_id,
        queued=False,
    )
    _job_context(job, policy, queued=False)
    _commit_context(commit, policy)
    _workflow_context(workflow_definition, policy)
