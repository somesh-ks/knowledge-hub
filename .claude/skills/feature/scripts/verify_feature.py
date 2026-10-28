#!/usr/bin/env python3
"""
Feature preflight verification helper for Singularity.
Deterministic CLI for fast early checks before running heavy browser suites.

Usage:
  python .claude/skills/feature/scripts/verify_feature.py --status
  python .claude/skills/feature/scripts/verify_feature.py --check
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path


def run_cmd(cmd: list[str]) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            shell=(sys.platform == "win32"),
        )
        return proc.returncode, proc.stdout + proc.stderr
    except Exception as e:
        return 1, str(e)


def check_git_status() -> tuple[bool, list[str]]:
    code, out = run_cmd(["git", "status", "--porcelain=v1", "-uall", "-z"])
    if code != 0:
        return False, []
    files = []
    parts = out.split("\0")
    idx = 0
    while idx < len(parts):
        entry = parts[idx]
        if not entry:
            idx += 1
            continue
        status = entry[:2]
        path = entry[3:]
        files.append(path)
        if "R" in status:
            idx += 1  # Consume following old path field for renames
        idx += 1
    return True, files


def check_em_dashes(files: list[str]) -> list[str]:
    issues = []
    for file_path in files:
        p = Path(file_path)
        if not p.is_file() or p.suffix not in (".md", ".ts", ".tsx", ".js", ".jsx", ".astro", ".css"):
            continue
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
            lines = content.splitlines()
            for idx, line in enumerate(lines, 1):
                if "\u2014" in line:
                    issues.append(f"{file_path}:{idx} contains em dash (use comma, colon, semicolon, or period)")
                    if len(issues) >= 10:
                        break
        except Exception:
            continue
    return issues


def check_raw_hex(files: list[str]) -> list[str]:
    issues = []
    hex_pattern = re.compile(r"#[0-9a-fA-F]{3,8}\b")
    url_pattern = re.compile(r"url\([^)]*\)|data:[^\s,;)]*")
    for file_path in files:
        p = Path(file_path)
        normalized = p.as_posix()
        # Skip token and foundation definition files where canonical color tokens are authored
        if "styles/tokens.css" in normalized or "styles/foundations.css" in normalized:
            continue
        if not p.is_file() or p.suffix not in (".astro", ".css", ".tsx", ".jsx", ".ts", ".js"):
            continue
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
            lines = content.splitlines()
            for idx, line in enumerate(lines, 1):
                clean_line = url_pattern.sub("", line)
                match = hex_pattern.search(clean_line)
                if match:
                    issues.append(f"{file_path}:{idx} contains raw hex {match.group(0)} (use semantic tokens)")
                    if len(issues) >= 10:
                        break
        except Exception:
            continue
    return issues


def main():
    parser = argparse.ArgumentParser(description="Feature preflight and status verifier")
    parser.add_argument("--status", action="store_true", help="Quick delta status check and early exit")
    parser.add_argument("--check", action="store_true", help="Run token and design checks on modified files")
    args = parser.parse_args()

    success, files = check_git_status()
    if not success:
        print("[FAIL] Failed to execute git status. Unable to verify working tree.")
        sys.exit(1)

    if not files and not args.check:
        print("[OK] Working tree clean. Zero pending changes.")
        sys.exit(0)

    if files:
        print(f"[STATUS] {len(files)} modified or untracked file(s) found.")
    else:
        print("[STATUS] Working tree clean.")

    if args.status:
        sys.exit(0)

    failed = False
    if files:
        dash_issues = check_em_dashes(files)
        hex_issues = check_raw_hex(files)

        if dash_issues:
            print("[FAIL] Em dashes detected in feature changes:")
            for issue in dash_issues[:5]:
                print(f"  - {issue}")
            failed = True
        else:
            print("[OK] No em dashes found in modified files.")

        if hex_issues:
            print("[FAIL] Raw hex colors detected (use semantic CSS tokens):")
            for issue in hex_issues[:5]:
                print(f"  - {issue}")
            failed = True
        else:
            print("[OK] No raw hex colors found.")

    if args.check:
        print("[RUN] Running design-check...")
        code, out = run_cmd(["npm", "run", "design-check"])
        if code != 0:
            print("[FAIL] npm run design-check failed:")
            print("\n".join(out.splitlines()[:10]))
            failed = True
        else:
            print("[OK] npm run design-check passed.")

    if failed:
        sys.exit(1)

    print("[SUCCESS] Feature preflight passed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
