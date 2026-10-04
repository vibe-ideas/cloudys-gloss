"""Compare fixed-corpus runs and hash-bound reviews. Does not call a judge model."""
import argparse
import hashlib
import html
import json
import statistics
from pathlib import Path


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def load_run(directory, corpus, corpus_hash):
    metadata = json.loads((directory / "metadata.json").read_text())
    rows = json.loads((directory / "results.json").read_text())
    if metadata["corpusHash"] != corpus_hash:
        raise ValueError(f"{directory}: corpus changed; rerun instead of reusing stale scores")
    expected = {(case["id"], repeat) for case in corpus["cases"] for repeat in range(1, metadata["repetitions"] + 1)}
    if len(rows) != len(expected) or {(row["id"], row["repetition"]) for row in rows} != expected:
        raise ValueError(f"{directory}: incomplete or duplicate results")
    review_path = directory / "reviews.json"
    reviews = {}
    if review_path.exists():
        review = json.loads(review_path.read_text())
        if any(review[key] != metadata[key] for key in ("corpusHash", "providerHash", "model")):
            raise ValueError(f"{directory}: reviews belong to a different corpus, provider or model")
        if not review.get("reviewer") or not review.get("method"):
            raise ValueError("Reviews must name the reviewer and method")
        for entry in review["reviews"]:
            key = (entry["id"], entry["outputHash"])
            if key in reviews:
                raise ValueError("Duplicate review")
            if any(type(entry[axis]) is not int or not 0 <= entry[axis] <= 4 for axis in ("adequacy", "completeness", "fluency")):
                raise ValueError("Review scores must be integers between 0 and 4")
            if type(entry["critical"]) is not bool or not isinstance(entry["notes"], str) or not entry["notes"].strip():
                raise ValueError("Each review requires a critical-error flag and evidence notes")
            reviews[key] = entry
        if set(reviews) - {(row["id"], row["outputHash"]) for row in rows}:
            raise ValueError("Review references a missing or changed output")
    for row in rows:
        canonical = json.dumps({"translations": row["translations"], "error": row.get("error")}, ensure_ascii=False, separators=(",", ":"))
        if digest(canonical) != row["outputHash"]:
            raise ValueError("Output changed after review: hash mismatch")
        review = reviews.get((row["id"], row["outputHash"]))
        row["review"] = review
        row["accepted"] = bool(review and row["assessment"]["automaticPassed"] and not row.get("error") and not review["critical"]
                               and review["adequacy"] >= 3 and review["completeness"] >= 3 and review["fluency"] >= 2)
    return {"metadata": metadata, "rows": rows, "directory": str(directory)}


def summary(run, corpus):
    rows = run["rows"]
    reviewed = [row for row in rows if row["review"]]
    by_case = {case["id"]: all(row["accepted"] for row in rows if row["id"] == case["id"]) for case in corpus["cases"]}
    return {"model": run["metadata"]["model"], "samples": len(rows),
            "automaticPassed": sum(row["assessment"]["automaticPassed"] for row in rows),
            "reviewed": len(reviewed), "acceptedCases": sum(by_case.values()), "cases": len(by_case), "byCase": by_case,
            "criticalCases": len({row["id"] for row in reviewed if row["review"]["critical"]}),
            "medianMs": statistics.median(row["elapsedMs"] for row in rows),
            "meanReview": {axis: statistics.mean(row["review"][axis] for row in reviewed) if reviewed else None for axis in ("adequacy", "completeness", "fluency")}}


def render(runs, corpus):
    lines = ["# 固定语料翻译质量对比", "", "自动检查不等于语义质量。评分来自署名逐例审阅，非独立盲评；同一输出的重复请求复用评分。", "",
             "| 模型 | 自动检查 | 已审阅请求 | 全部轮次可接受的用例 | 严重错误用例 |", "| --- | ---: | ---: | ---: | ---: |"]
    for run in runs:
        item = summary(run, corpus)
        lines.append(f"| {item['model']} | {item['automaticPassed']}/{item['samples']} | {item['reviewed']}/{item['samples']} | {item['acceptedCases']}/{item['cases']} | {item['criticalCases']} |")
    for case in corpus["cases"]:
        lines.extend(["", f"## {case['id']} · {case['title']}", "", "原文："])
        for source in case["texts"]:
            lines.extend(["", "> " + html.escape(source).replace("\n", "\n> ")])
        lines.extend(["", "参考译文（允许同义表达）：", "", html.escape("\n\n".join(case["referenceZh"])), "", "审阅要点：", ""])
        lines.extend("- " + requirement for requirement in case["requirements"])
        for run in runs:
            matching = [row for row in run["rows"] if row["id"] == case["id"]]
            for output_hash in dict.fromkeys(row["outputHash"] for row in matching):
                group = [row for row in matching if row["outputHash"] == output_hash]
                row = group[0]
                lines.extend(["", f"### {run['metadata']['model']} · 轮次 {', '.join(str(r['repetition']) for r in group)}", "",
                              html.escape("\n\n".join(row["translations"])) or "（没有有效译文）", ""])
                if row.get("error"):
                    lines.append("调用错误：" + html.escape(row["error"]))
                lines.append("自动检查：" + ("通过" if row["assessment"]["automaticPassed"] else "失败"))
                for issue in row["assessment"]["errors"] + row["assessment"]["review"]:
                    lines.append("- " + html.escape(issue))
                review = row["review"]
                lines.extend(["", f"审阅：忠实度 {review['adequacy']}/4 · 完整性 {review['completeness']}/4 · 自然度 {review['fluency']}/4 · 严重错误 {'有' if review['critical'] else '无'}。{html.escape(review['notes'])}" if review else "审阅：待完成，不计为质量合格。"])
    return "\n".join(line.rstrip() for line in "\n".join(lines).splitlines()) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("runs", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=Path("artifacts/quality/comparison.md"))
    parser.add_argument("--summary", type=Path, help="Optional separate path for machine-readable summary")
    parser.add_argument("--corpus", type=Path, default=Path("tests/quality/cases.json"), help="Use an archived corpus only when reproducing its matching historical runs")
    parser.add_argument("--baseline", type=Path, help="Reject regressions from previously accepted baseline cases")
    parser.add_argument("--gate", action="store_true", help="Require every case to be reviewed and acceptable")
    args = parser.parse_args()
    corpus_text = args.corpus.read_text()
    corpus = json.loads(corpus_text)
    runs = [load_run(directory, corpus, digest(corpus_text)) for directory in args.runs]
    if len({run["metadata"]["providerHash"] for run in runs}) != 1:
        raise ValueError("Provider versions differ; do not present this as a model-only comparison")
    summaries = [summary(run, corpus) for run in runs]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(runs, corpus))
    summary_path = args.summary or args.output.with_suffix(".json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summaries, ensure_ascii=False, indent=2) + "\n")
    regressions = []
    if args.baseline:
        baseline_run = load_run(args.baseline, corpus, digest(corpus_text))
        if any(run["metadata"]["providerHash"] != baseline_run["metadata"]["providerHash"] for run in runs):
            raise ValueError("Baseline provider differs; compare the pipeline change separately")
        baseline = summary(baseline_run, corpus)
        if baseline["reviewed"] != baseline["samples"]:
            raise ValueError("Baseline reviews are incomplete")
        for item in summaries:
            regressions.extend(f"{item['model']}: {case}" for case, accepted in baseline["byCase"].items() if accepted and not item["byCase"][case])
    print(json.dumps({"summary": summaries, "regressions": regressions, "report": str(args.output)}, ensure_ascii=False, indent=2))
    pending = any(item["reviewed"] != item["samples"] for item in summaries)
    failed_gate = args.gate and any(item["acceptedCases"] != item["cases"] for item in summaries)
    raise SystemExit(1 if regressions or pending or failed_gate else 0)


if __name__ == "__main__":
    main()
