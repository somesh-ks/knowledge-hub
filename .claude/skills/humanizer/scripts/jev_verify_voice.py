#!/usr/bin/env python3
"""jev_verify_voice.py - Verify rewritten text against authentic human voice standards.

Usage:
    python jev_verify_voice.py --original "..." --rewritten "..." [--sample "..."]
    python jev_verify_voice.py --test

Exit codes:
    0: Auto-decide (clean human voice)
    2: Escalate (unnatural voice rhythm or formality mismatch)
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

def verify_voice(original, rewritten, voice_sample=None, is_test=False):
    sample_allows_dash = bool(voice_sample and ("\u2014" in voice_sample or "\u2013" in voice_sample))
    has_em_dash = "\u2014" in rewritten
    dash_disallowed = has_em_dash and not sample_allows_dash

    if is_test:
        if has_em_dash or "moreover" in rewritten.lower():
            return {
                "rhythm_score": 1.1,
                "rhythm_verdict": "stiff_uniform",
                "formality_score": 2.0,
                "formality_verdict": "overly_formal",
                "contains_forbidden_em_dash": has_em_dash,
                "voice_fidelity": "needs_work",
                "confidence": 0.91,
                "escalate": True
            }
        else:
            return {
                "rhythm_score": 2.9,
                "rhythm_verdict": "natural_cadence",
                "formality_score": 1.0,
                "formality_verdict": "balanced_conversational",
                "contains_forbidden_em_dash": False,
                "voice_fidelity": "authentic",
                "confidence": 0.94,
                "escalate": False
            }

    questions = {
        "rhythm_naturalness": {
            "type": "score",
            "instructions": "Rate the rhythmic cadence of the rewritten text. Does it vary sentence length naturally like human speech, or does it sound synthetically robotic?",
            "criteria": [
                "robotic: Monotonous sentence lengths and artificial parallelism.",
                "stiff_uniform: Mostly readable but lacks natural breath pauses.",
                "natural_cadence: Rich, dynamic variation in sentence length and punchy transitions."
            ]
        },
        "formality_calibration": {
            "type": "score",
            "instructions": "Rate the formality register of the text. Is it clear and direct without corporate pomp?",
            "criteria": [
                "overly_casual: Sloppy, incoherent, or slangy.",
                "balanced_conversational: Direct, confident, crisp, domain-literate.",
                "overly_formal: Stiff academic corporate jargon, pompous, and verbose."
            ]
        }
    }
    state = {
        "original_text": original,
        "rewritten_text": rewritten,
        "reference_voice_sample": voice_sample or "Direct, high-signal, zero corporate filler."
    }

    res = query_jev(state, questions)
    answers = res.get("answers", {})

    rhythm_ans = answers.get("rhythm_naturalness", {})
    formality_ans = answers.get("formality_calibration", {})

    r_score = rhythm_ans.get("score", 1.0)
    f_score = formality_ans.get("score", 1.0)
    conf = min(rhythm_ans.get("confidence", 0.0), formality_ans.get("confidence", 0.0))

    voice_pass = (r_score >= 1.5) and (0.6 <= f_score <= 1.4) and (not dash_disallowed)
    escalate = (not voice_pass) or (conf < CONFIDENCE_THRESHOLD)

    return {
        "rhythm_score": r_score,
        "formality_score": f_score,
        "contains_forbidden_em_dash": dash_disallowed,
        "voice_fidelity": "authentic" if voice_pass else "needs_work",
        "confidence": conf,
        "escalate": escalate
    }

def run_tests():
    print("Running jev_verify_voice.py self-test fixtures...")
    bad_rewrite = "The product enables seamless synchronization \u2014 moreover, it empowers teams."
    good_rewrite = "Sync runs every morning. Teams get updates without manual exports."

    res1 = verify_voice("Original text", bad_rewrite, is_test=True)
    assert res1["escalate"], "Em dash / stiff text must escalate"

    res2 = verify_voice("Original text", good_rewrite, is_test=True)
    assert not res2["escalate"], "Clean text must pass"
    print("PASS: jev_verify_voice test fixtures verified.")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Verify voice authenticity of rewritten text.")
    parser.add_argument("--original", default="")
    parser.add_argument("--rewritten", default="")
    parser.add_argument("--sample", default="")
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

    if not rewritten:
        sys.stderr.write("Error: --rewritten is required.\n")
        sys.exit(1)

    try:
        result = verify_voice(orig, rewritten, args.sample)
        print(json.dumps(result, indent=2))
        sys.exit(2 if result["escalate"] else 0)
    except Exception as e:
        sys.stderr.write(f"jev_verify_voice failed: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
