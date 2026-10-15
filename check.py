#!/usr/bin/env python3
"""Run tests, check public pins and validate both generated fixture transports."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys

from contract_adapter import adapt, check_pair
from generator import InputError, generate
from run import digest, read_json, verify_baseline, verify_snapshot
from transport import validate


ROOT = Path(__file__).resolve().parent


def privacy_check():
    patterns = [
        re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/"),
        re.compile(r"[A-Z]:\\Users\\[A-Za-z0-9_.-]+\\"),
        re.compile(r"apk_[A-Za-z0-9]{24,}"),
        re.compile(r"sk-[A-Za-z0-9_-]{24,}"),
        re.compile(r"(?im)^\s*(?:Co-Authored-By|Generated-with):"),
        re.compile(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    ]
    ignored = {".git", ".local", "__pycache__"}
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if any(part in ignored for part in relative.parts):
            continue
        if path.is_symlink():
            raise InputError(f"{relative}: repository files must not be symlinks")
        if path.suffix.lower() in {".html", ".htm"}:
            raise InputError(f"{relative}: unexpected web artifact")
        if path.is_file() and path.suffix in {".py", ".json", ".md", ".mjs"}:
            text = path.read_text(encoding="utf-8")
            if any(pattern.search(text) for pattern in patterns):
                raise InputError(f"{relative}: privacy check failed")


def main():
    checked = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
        cwd=ROOT, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
    )
    if checked.returncode:
        return checked.returncode
    node_checked = subprocess.run(
        ["node", "--test", "tests/gateway.test.mjs", "tests/model.test.mjs", "tests/display.test.mjs", "tests/native.test.mjs", "tests/context.test.mjs", "tests/instructional.test.mjs"], cwd=ROOT,
    )
    if node_checked.returncode:
        return node_checked.returncode
    try:
        privacy_check()
        config = read_json(ROOT / "config.json")
        manifest = read_json(ROOT / config["knowledge_manifest"])
        verify_snapshot(manifest)
        baseline_path = ROOT / config["knowledge_baseline"]
        verify_baseline(read_json(baseline_path), manifest, digest(baseline_path.read_bytes()))
        methods = read_json(ROOT / config["methods"])
        formats = read_json(ROOT / config["formats"])
        lessons = read_json(ROOT / "examples" / "lessons.json")["lessons"]
        count = 0
        for lesson in lessons:
            response = generate(lesson, formats, methods)
            context, question_set = adapt(lesson, response, {"kind": "fixture-check"})
            validate(context, read_json(ROOT / "schema" / "lesson-context.schema.json"))
            validate(question_set, read_json(ROOT / "schema" / "question-set.schema.json"))
            count += check_pair(context, question_set)
    except (InputError, OSError, ValueError) as error:
        print("Check failed:", error, file=sys.stderr)
        return 1
    print(f"{count} fixture questions validated; public pins and privacy check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
