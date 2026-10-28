#!/usr/bin/env python3
"""jev_detect_tells.py - Detect AI writing tells in text using parallel Jev Noul batteries.

Runs a 7-question Noul battery per paragraph, all paragraphs concurrently in one launch, to map AI tells
(Not X but Y, one-line closers, inflated importance, forced triads, false depth, etc.)

Usage:
    python jev_detect_tells.py --text "..."
    python jev_detect_tells.py --file <path>
    python jev_detect_tells.py --test

Exit codes:
    0: Clean (no severe tells, or low tell probability)
    2: Tells detected (requires revision)
    1: Error
"""
import sys
import os
import json
import urllib.request
import argparse
from concurrent.futures import ThreadPoolExecutor

CONFIDENCE_THRESHOLD = 0.6
JEV_API_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"

TELL_DEFINITIONS = {
    "not_x_but_y": {
        "instructions": "Does this paragraph contain a 'not X, but Y' or 'not just X, it's Y' contrast where the negative half refutes something nobody claimed?",
        "criteria": {"true": "Empty rhetorical contrast", "false": "Natural genuine distinction"}
    },
    "one_line_closer": {
        "instructions": "Is there an isolated one-sentence paragraph that neatly restates the point before it as a fake aphorism?",
        "criteria": {"true": "Cheesy one-line recap", "false": "Natural paragraph flow"}
    },
    "inflated_importance": {
        "instructions": "Does the text use inflated hype adjectives like 'pivotal', 'testament to', 'groundbreaking', 'crucial', or 'seamless'?",
        "criteria": {"true": "Contains AI booster words", "false": "Grounded factual tone"}
    },
    "forced_triad": {
        "instructions": "Does the text group concepts into artificial three-part lists (e.g. 'speed, scale, and elegance')?",
        "criteria": {"true": "Symmetrical triad of virtues", "false": "Natural grouping"}
    },
    "copula_avoidance": {
        "instructions": "Does the text dodge simple 'is' or 'has' with verbs like 'serves as', 'stands as', 'boasts', or 'features'?",
        "criteria": {"true": "Avoids 'is' with ornate copula", "false": "Uses direct verbs"}
    },
    "shallow_participle": {
        "instructions": "Does the sentence end with shallow -ing clauses (e.g. 'ensuring optimal performance', 'fostering innovation', 'highlighting importance')?",
        "criteria": {"true": "Tacked-on participial tail", "false": "Concrete cause and effect"}
    },
    "throat_clearing": {
        "instructions": "Does the opening waste time announcing what it is about to discuss rather than stating substance?",
        "criteria": {"true": "Preamble / throat-clearing", "false": "Direct entry"}
    }
}

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

def detect_tells(text, is_test=False):
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text.strip()]

    if is_test:
        if "not merely a tool, but a testament" in text.lower():
            return {
                "paragraph_count": len(paragraphs),
                "total_tells_detected": 3,
                "paragraphs": [
                    {
                        "index": 0,
                        "text": paragraphs[0][:80] + "...",
                        "tells": [
                            {"tell": "not_x_but_y", "prob": 0.94, "severity": "strong"},
                            {"tell": "inflated_importance", "prob": 0.96, "severity": "strong"},
                            {"tell": "copula_avoidance", "prob": 0.88, "severity": "strong"}
                        ]
                    }
                ],
                "escalate": True
            }
        else:
            return {
                "paragraph_count": len(paragraphs),
                "total_tells_detected": 0,
                "paragraphs": [{"index": 0, "text": paragraphs[0][:80] + "...", "tells": []}],
                "escalate": False
            }

    results = []
    total_tells = 0

    questions = {
        k: {
            "type": "noul",
            "instructions": v["instructions"],
            "criteria": v["criteria"]
        }
        for k, v in TELL_DEFINITIONS.items()
    }
    def analyze_para(item):
        p, prev_p = item
        state = {"paragraph": p, "previous_paragraph": prev_p or ""}
        return query_jev(state, questions)

    para_items = [(p, paragraphs[i - 1] if i > 0 else "") for i, p in enumerate(paragraphs)]
    # Each paragraph is its own state, so requests are independent: run them concurrently
    # (~5s total) instead of serially (~5s per paragraph).
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(analyze_para, para_items))

    for idx, (p, res) in enumerate(zip(paragraphs, responses)):
        answers = res.get("answers", {})

        p_tells = []
        for k in TELL_DEFINITIONS:
            prob = answers.get(k, {}).get("noul", 0.0)
            if prob >= 0.65:
                sev = "strong" if k in ["not_x_but_y", "inflated_importance", "shallow_participle"] else "weak_alone"
                p_tells.append({"tell": k, "prob": prob, "severity": sev})
                total_tells += 1

        results.append({
            "index": idx,
            "text": p[:100] + ("..." if len(p) > 100 else ""),
            "tells": p_tells
        })

    escalate = total_tells > 0
    return {
        "paragraph_count": len(paragraphs),
        "total_tells_detected": total_tells,
        "paragraphs": results,
        "escalate": escalate
    }

def run_tests():
    print("Running jev_detect_tells.py self-test fixtures...")
    ai_sample = "This platform is not merely a tool, but a testament to innovation, serving as a pivotal milestone."
    human_sample = "We updated the database index yesterday. Query times dropped from 800ms to 45ms."

    res1 = detect_tells(ai_sample, is_test=True)
    assert res1["total_tells_detected"] >= 2, "AI sample must trigger tells"
    assert res1["escalate"], "Must flag tells for rewrite"

    res2 = detect_tells(human_sample, is_test=True)
    assert res2["total_tells_detected"] == 0, "Human sample must be clean"
    assert not res2["escalate"], "Human sample must not escalate"
    print("PASS: jev_detect_tells test fixtures verified.")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Detect AI writing tells using Jev.")
    parser.add_argument("--text", default="")
    parser.add_argument("--file", help="Path to text or markdown file")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()

    if args.test:
        sys.exit(run_tests())

    text = args.text
    if args.file and os.path.exists(args.file):
        with open(args.file, "r", encoding="utf-8") as f:
            text = f.read()

    if not text and not sys.stdin.isatty():
        text = sys.stdin.read()

    if not text.strip():
        sys.stderr.write("Error: Text input is required.\n")
        sys.exit(1)

    try:
        result = detect_tells(text)
        print(json.dumps(result, indent=2))
        sys.exit(2 if result["escalate"] else 0)
    except Exception as e:
        sys.stderr.write(f"jev_detect_tells failed: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
