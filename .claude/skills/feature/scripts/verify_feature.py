#!/usr/bin/env python3
"""
Feature preflight verification helper for Singularity.
Deterministic CLI for fast early checks before running heavy browser suites.

Usage:
  python scripts/verify_feature.py --status
  python scripts/verify_feature.py --check
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path


def run_cmd(cmd: list[str]) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        return proc.returncode, proc.stdout + proc.stderr
    except Exception as e:
        return 1, str(e)


def check_git_status() -> list[str]:
    code, out = run_cmd(["git", "status", "--porcelain"])
    if code != 0:
        return []
    files = []
    for line in out.splitlines():
        if len(line) > 3:
            files.append(line[3:].strip())
    return files


def check_em_dashes(files: list[str]) -> list[str]:
    issues = []
    for file_path in files:
        p = Path(file_path)
        if not p.is_file() or p.suffix not in (".md", ".ts", ".astro", ".css", ".js"):
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
    for file_path in files:
        p = Path(file_path)
        if not p.is_file() or p.suffix not in (".astro", ".css"):
            continue
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
            lines = content.splitlines()
            for idx, line in enumerate(lines, 1):
                # Ignore url() or hash fragments
                if "url(" in line or "data:" in line:
                    continue
                match = hex_pattern.search(line)
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

    files = check_git_status()
    if not files:
        print("[OK] Working tree clean. Zero pending changes.")
        sys.exit(0)

    print(f"[STATUS] {len(files)} modified or untracked file(s) found.")

    dash_issues = check_em_dashes(files)
    hex_issues = check_raw_hex(files)

    failed = False
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

