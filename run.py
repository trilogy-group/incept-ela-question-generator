#!/usr/bin/env python3
"""One offline entry point for generation, construction checks and traceable output."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

from contract_adapter import adapt, check_pair
from generator import InputError, generate
from transport import validate


ROOT = Path(__file__).resolve().parent
CONFIG_KEYS = {"version", "execution", "input", "formats", "methods", "knowledge_manifest", "run_root"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def safe_path(relative):
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise InputError("Configuration paths must stay inside this repository")
    result = ROOT / path
    for parent in (result, *result.parents):
        if parent == ROOT.parent:
            break
        if parent.is_symlink():
            raise InputError("Configuration/output paths cannot traverse symlinks")
    return result


def write_json(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    path.chmod(0o600)


def verify_snapshot(manifest):
    if manifest.get("boundary") != "public-generation-only":
        raise InputError("Knowledge snapshot must declare the public generation boundary")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise InputError("Public knowledge manifest has no pinned files")
    seen = set()
    for entry in files:
        path = safe_path(entry["path"])
        if entry["path"] in seen or digest(path.read_bytes()) != entry["sha256"]:
            raise InputError("Public knowledge snapshot is changed or duplicated")
        seen.add(entry["path"])
    return seen


def execute(input_path=None, check_tests=True):
    config = read_json(ROOT / "config.json")
    if set(config) != CONFIG_KEYS or config["version"] != 1 or config["execution"] != "offline-only":
        raise InputError("Unsupported configuration; this runner only executes the offline prototype")
    paths = {key: safe_path(config[key]) for key in ("input", "formats", "methods", "knowledge_manifest", "run_root")}
    if not Path(config["run_root"]).parts[:1] == (".local",):
        raise InputError("Run output must be inside .local")
    manifest = read_json(paths["knowledge_manifest"])
    pinned = verify_snapshot(manifest)
    if not {config["formats"], config["methods"]} <= pinned:
        raise InputError("Generation methods and format descriptors must both be pinned")
    selected_input = safe_path(input_path) if input_path else paths["input"]
    input_bytes = selected_input.read_bytes()
    supplied = json.loads(input_bytes)
    specs = supplied.get("lessons") if isinstance(supplied, dict) else None
    if specs is None and isinstance(supplied, dict) and "request" in supplied:
        specs = [supplied]
    if not isinstance(specs, list) or not specs:
        raise InputError("Input must be one authored semantic packet or a nonempty lessons list")
    ids = [spec.get("id") for spec in specs]
    if any(not isinstance(name, str) or not name or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in name) for name in ids) or len(set(ids)) != len(ids):
        raise InputError("Lesson identifiers must be unique lowercase slugs")
    formats = read_json(paths["formats"])
    methods = read_json(paths["methods"])
    run_id = "run-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    paths["run_root"].mkdir(parents=True, exist_ok=True, mode=0o700)
    safe_path(config["run_root"])
    paths["run_root"].chmod(0o700)
    directory = paths["run_root"] / run_id
    directory.mkdir(mode=0o700)
    metadata = {
        "run": run_id, "state": "running", "execution": "offline-only", "model_calls": 0,
        "input_sha256": digest(input_bytes),
        "generator_sha256": digest((ROOT / "generator.py").read_bytes()),
        "adapter_sha256": digest((ROOT / "contract_adapter.py").read_bytes()),
        "knowledge_manifest_sha256": digest(paths["knowledge_manifest"].read_bytes()),
        "qualification": "Independent academic quality, model generality and evaluator trust are not verified.",
        "lessons": [],
    }
    try:
        if check_tests:
            env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
            checked = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"], cwd=ROOT, capture_output=True, text=True, env=env)
            (directory / "checks.log").write_text(checked.stdout + checked.stderr, encoding="utf-8")
            (directory / "checks.log").chmod(0o600)
            if checked.returncode:
                raise InputError("Construction and delivery tests failed; inspect checks.log")
            metadata["tests"] = "passed; exact counts in checks.log"
        built = []
        for spec in specs:
            response = generate(spec, formats, methods)
            destination = directory / spec["id"]
            destination.mkdir(mode=0o700)
            write_json(destination / "input.json", spec)
            write_json(destination / "teacher.json", {key: value for key, value in response.items() if key != "student_view"})
            write_json(destination / "learner.json", response["student_view"])
            write_json(destination / "trace.json", response["generation_trace"])
            row = {"id": spec["id"], "status": response["status"], "items": len(response["items"]), "holds": response["holds"]}
            if response["status"] == "prepared-for-review":
                source = {"kind": "generator-run", "run": run_id, "input_sha256": metadata["input_sha256"], "generator_sha256": metadata["generator_sha256"], "knowledge_manifest_sha256": metadata["knowledge_manifest_sha256"]}
                context, question_set = adapt(spec, response, source)
                validate(context, read_json(ROOT / "schema" / "lesson-context.schema.json"))
                validate(question_set, read_json(ROOT / "schema" / "question-set.schema.json"))
                row["contract_items_checked"] = check_pair(context, question_set)
                write_json(destination / "lesson-context.json", context)
                write_json(destination / "question-set.json", question_set)
                built.append((spec, response))
            metadata["lessons"].append(row)
        verify_snapshot(manifest)
        if digest(selected_input.read_bytes()) != metadata["input_sha256"]:
            raise InputError("Input changed during generation")
        metadata["state"] = "prepared-for-review" if len(built) == len(specs) else "held"
    except Exception as error:
        metadata["state"] = "failed"
        metadata["error"] = str(error)
        write_json(directory / "run.json", metadata)
        raise
    write_json(directory / "run.json", metadata)
    current = ROOT / ".local" / "current.json"
    temporary = current.with_name("current-" + uuid.uuid4().hex + ".json")
    write_json(temporary, {"run": run_id, "directory": str(directory.relative_to(ROOT)), "state": metadata["state"]})
    if current.is_symlink():
        temporary.unlink()
        raise InputError("Current pointer must not be a symlink")
    os.replace(temporary, current)
    return directory, metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="Optional public authored semantic packet JSON")
    args = parser.parse_args()
    try:
        directory, metadata = execute(args.input)
    except (InputError, OSError, ValueError) as error:
        print("Generation stopped:", error, file=sys.stderr)
        return 1
    print(json.dumps({
        "state": metadata["state"], "questions": sum(row["items"] for row in metadata["lessons"]),
        "model_calls": 0, "run": str(directory.relative_to(ROOT)),
        "outputs": [str(path.relative_to(ROOT)) for path in sorted(directory.rglob("*.json"))],
    }, indent=2))
    return 0 if metadata["state"] == "prepared-for-review" else 2


if __name__ == "__main__":
    sys.exit(main())
