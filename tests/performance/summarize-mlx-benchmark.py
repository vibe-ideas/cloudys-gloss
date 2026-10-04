"""Summarize a completed benchmark-mlx-models.ts run, without model dependencies."""
import json
import statistics
import sys
from pathlib import Path


def summarize(directory):
    rows = [json.loads(line) for line in (directory / "results.jsonl").read_text().splitlines()]
    median = statistics.median
    output = []
    for model in dict.fromkeys(row["model"] for row in rows):
        samples = [row for row in rows if row["model"] == model and row["kind"] == "tps"]
        calls = [row for row in rows if row["model"] == model and row["kind"] == "provider"]
        cases = []
        for case in dict.fromkeys(row["scenario"] for row in calls):
            matching = [row for row in calls if row["scenario"] == case]
            cases.append({
                "id": case, "n": len(matching), "success": sum(row["success"] for row in matching),
                "medianMs": median(row["totalMs"] for row in matching),
                "firstMs": median(row["firstMs"] for row in matching) if all("firstMs" in row for row in matching) else None,
                "requests": [row["requests"] for row in matching],
            })
        output.append({
            "model": model, "samples": len(samples),
            "decodeTpsMedian": median(row["decodeTps"] for row in samples),
            "decodeTpsRange": [min(row["decodeTps"] for row in samples), max(row["decodeTps"] for row in samples)],
            "ttftMsMedian": median(row["firstMs"] for row in samples),
            "totalMsMedian": median(row["totalMs"] for row in samples),
            "endToEndTpsMedian": median(row["endToEndTps"] for row in samples),
            "completionTokens": sorted(set(row["usage"]["completion_tokens"] for row in samples)),
            "scenarios": cases,
        })
    (directory / "summary.json").write_text(json.dumps(output, indent=2) + "\n")
    memory = []
    for source in sorted(directory.glob("*-memory.txt")):
        lines = source.read_text().splitlines()
        memory.append({"file": source.name, "summary": [line for line in lines if
            "Physical footprint" in line or line.startswith("TOTAL ") or "mapped file" in line]})
    if memory:
        (directory / "memory-summary.json").write_text(json.dumps(memory, indent=2) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    summarize(Path(sys.argv[1]))
