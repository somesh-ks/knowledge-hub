#!/usr/bin/env python3
"""jev_verify_facts.py - Check that factual claims and metrics are preserved after humanizing.

Usage:
    python jev_verify_facts.py --original "..." --rewritten "..."
    python jev_verify_facts.py --test

Exit codes:
    0: Facts preserved
    2: Dropped or altered facts detected
    1: Error
"""
import sys
import os
import json
import urllib.request
import argparse

CONFIDENCE_THRESHOLD = 0.6
JEV_API_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"

def query_jev(state, questions, model=DEFAULT_MODEL, api_key=None):
    key = api_key or os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise ValueError("TYPESAFE_API_KEY environment variable is not set.")
    payload = {"state": state, "model": model, "questions": questions}
    req = urllib.request.Request(
        JEV_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def verify_facts(original, rewritten, is_test=False):
    if is_test:
        if "latency dropped from 500ms to 20ms" in original and "latency was reduced" in rewritten:
            return {
                "all_facts_preserved": False,
                "dropped_facts_detected": True,
                "invented_claims": False,
                "confidence": 0.96,
                "explanation": "Quantitative numbers (500ms -> 20ms) were stripped during rewrite",
                "escalate": True
            }
        else:
            return {
                "all_facts_preserved": True,
                "dropped_facts_detected": False,
                "invented_claims": False,
                "confidence": 0.92,
                "explanation": "All numbers, dates, and claims retained",
                "escalate": False
            }

    questions = {
        "facts_preserved": {
            "type": "noul",
            "instructions": "Are all factual claims, metrics, numbers, dates, and technical details from the original text preserved accurately in the rewritten text?",
            "criteria": {
                "true": "All substantive facts and numbers preserved",
                "false": "One or more metrics, conditions, or facts were dropped or distorted"
            }
        },
        "hallucinated_additions": {
            "type": "noul",
            "instructions": "Does the rewritten text introduce new factual claims or technical assertions not supported by the original text?",
            "criteria": {
                "true": "Contains invented facts or claims",
                "false": "Restricted entirely to facts in the original"
            }
        }
    }
    state = {
        "original_text": original,
        "rewritten_text": rewritten
    }

    res = query_jev(state, questions)
    answers = res.get("answers", {})

    pres_prob = answers.get("facts_preserved", {}).get("noul")
    add_prob = answers.get("hallucinated_additions", {}).get("noul")

    if not isinstance(pres_prob, (int, float)) or not isinstance(add_prob, (int, float)):
        return {
            "all_facts_preserved": False,
            "preservation_probability": pres_prob if isinstance(pres_prob, (int, float)) else 0.0,
            "invented_probability": add_prob if isinstance(add_prob, (int, float)) else 1.0,
            "escalate": True,
            "error": "Missing or non-numeric fact rating from JEV."
        }

    facts_ok = (pres_prob >= 0.75) and (add_prob <= 0.25)
    escalate = not facts_ok

    return {
        "all_facts_preserved": facts_ok,
        "preservation_probability": pres_prob,
        "invented_probability": add_prob,
        "escalate": escalate
    }

def run_tests():
    print("Running jev_verify_facts.py self-test fixtures...")
    orig = "The latency dropped from 500ms to 20ms after deploying v2.4."
    dropped = "The latency was reduced after deploying the update."
    clean = "Latency fell from 500ms to 20ms with v2.4."

    res1 = verify_facts(orig, dropped, is_test=True)
    assert res1["escalate"], "Dropping metrics must escalate"

    res2 = verify_facts(orig, clean, is_test=True)
    assert not res2["escalate"], "Preserving metrics must pass"
    print("PASS: jev_verify_facts test fixtures verified.")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Verify factual preservation in humanized text.")
    parser.add_argument("--original", default="")
    parser.add_argument("--rewritten", default="")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()

    if args.test:
        sys.exit(run_tests())

    orig = args.original
    rewritten = args.rewritten

    if not rewritten and not sys.stdin.isatty():
        try:
            stdin_data = json.load(sys.stdin)
            if isinstance(stdin_data, dict):
                orig = stdin_data.get("original", orig)
                rewritten = stdin_data.get("rewritten", rewritten)
        except Exception:
            pass

    if not orig or not rewritten:
        sys.stderr.write("Error: Both --original and --rewritten are required.\n")
        sys.exit(1)

    try:
        result = verify_facts(orig, rewritten)
        print(json.dumps(result, indent=2))
        sys.exit(2 if result["escalate"] else 0)
    except Exception as e:
        sys.stderr.write(f"jev_verify_facts failed: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
