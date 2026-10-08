"""Local retrieval diagnostic; no translation model changes or browser integration.

Install tests/performance/embedding-requirements.txt into an isolated Python 3.12
environment, then pass a pinned Hugging Face revision. Uses no remote model code.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import random
import re
import threading
import time

import numpy as np
import psutil
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[2]


def lexical_tokens(text):
    """BM25 baseline: English words plus overlapping Chinese character bigrams."""
    words = re.findall(r"[a-z0-9_]+", text.lower())
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        words.extend(run[i:i + 2] for i in range(max(1, len(run) - 1)))
    return words


def bm25_scores(documents, queries):
    tokens = [lexical_tokens(d["title"] + " " + d["text"]) for d in documents]
    frequencies = [Counter(t) for t in tokens]
    document_frequency = Counter(t for words in tokens for t in set(words))
    average_length = sum(map(len, tokens)) / len(tokens)
    rows = []
    for query in queries:
        scores = []
        for words, frequency in zip(tokens, frequencies):
            score = 0.0
            for term in set(lexical_tokens(query)):
                count = frequency[term]
                df = document_frequency[term]
                idf = math.log(1 + (len(tokens) - df + 0.5) / (df + 0.5))
                score += idf * count * 2.5 / (count + 1.5 * (0.25 + 0.75 * len(words) / average_length))
            scores.append(score)
        rows.append(scores)
    return np.array(rows)


def truncate_normalize(vectors, dimensions):
    vectors = np.asarray(vectors, dtype=np.float32)[:, :dimensions]
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if not np.isfinite(vectors).all() or np.any(norms == 0):
        raise ValueError("Embedding must be finite and nonzero before normalization")
    return vectors / norms


def evaluate(documents, cases, scores):
    """Full-corpus ranking and separate same-headword sense selection."""
    ids = [d["id"] for d in documents]
    rows = []
    for case, row in zip(cases, scores):
        # Stable ordering makes all-zero lexical ties reproducible and visible.
        order = np.argsort(-row, kind="stable")
        rank = list(order).index(ids.index(case["expected"])) + 1
        result = {
            "id": case["id"], "scenario": case["scenario"], "category": case["category"],
            "query": case["query"], "expected": case["expected"], "rank": rank,
            "top3": [{"id": ids[i], "score": float(row[i])} for i in order[:3]],
        }
        if case.get("word"):
            candidates = [i for i in order if documents[i].get("word") == case["word"]]
            result["sense_rank"] = candidates.index(ids.index(case["expected"])) + 1
            result["sense_selected"] = ids[candidates[0]]
        rows.append(result)
    grouped = defaultdict(list)
    for row in rows:
        grouped["all"].append(row)
        grouped[row["category"]].append(row)
    summary = {}
    for category, values in grouped.items():
        summary[category] = {
            "count": len(values), "hit1": sum(r["rank"] == 1 for r in values) / len(values),
            "hit3": sum(r["rank"] <= 3 for r in values) / len(values),
            "mrr": sum(1 / r["rank"] for r in values) / len(values),
        }
        if category == "sense":
            summary[category]["same_headword_hit1"] = sum(r["sense_rank"] == 1 for r in values) / len(values)
    return {"summary": summary, "cases": rows}


def statistics(values):
    return {"count": len(values), "median_ms": float(np.median(values)),
            "p95_ms": float(np.percentile(values, 95)), "min_ms": min(values), "max_ms": max(values)}


class MemorySampler:
    """RSS and MPS snapshots, NOT physical footprint or total device memory."""
    def __init__(self, device, runtime):
        self.device = device
        self.runtime = runtime
        self.stop = threading.Event()
        self.process = psutil.Process()
        self.peak = {}
        self.thread = threading.Thread(target=self.run, daemon=True)

    def sample(self):
        values = {"rss_bytes": self.process.memory_info().rss}
        if self.device == "mps":
            values.update(mps_tensor_bytes=self.runtime.mps.current_allocated_memory(),
                          mps_driver_bytes=self.runtime.mps.driver_allocated_memory())
        elif self.device == "mlx":
            values.update(mlx_active_bytes=self.runtime.get_active_memory(),
                          mlx_cache_bytes=self.runtime.get_cache_memory(),
                          mlx_peak_active_bytes=self.runtime.get_peak_memory())
        for name, value in values.items():
            self.peak[name] = max(value, self.peak.get(name, 0))
        return values

    def run(self):
        while not self.stop.wait(0.02):
            self.sample()


class MLXTextEncoder:
    """Use the upstream pinned loader; omit unused encoders via public config."""
    def __init__(self, snapshot):
        import mlx.core as mx
        from mlx.utils import tree_flatten
        from mlx_vlm.embedding_loader import load_embedding_model
        from transformers import AutoTokenizer

        config = json.loads((snapshot / "config.json").read_text())
        config.update(vision_config=None, audio_config=None)
        self.model = load_embedding_model(snapshot, config=config)
        self.tokenizer = AutoTokenizer.from_pretrained(snapshot, trust_remote_code=False)
        self.prompts = json.loads((snapshot / "config_sentence_transformers.json").read_text())["prompts"]
        self.mx = mx
        # Quantized weights include packed values, scales and offsets. Do not call
        # the packed element count a count of unquantized learned parameters.
        self.weight_storage_bytes = sum(p.nbytes for _, p in tree_flatten(self.model.parameters()))
        self.quantization = config.get("quantization")

    def encode(self, texts, *, prompt, batch_size, **_kwargs):
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]), reverse=True)
        outputs = []
        for offset in range(0, len(order), batch_size):
            positions = order[offset:offset + batch_size]
            inputs = self.tokenizer([prompt + texts[i] for i in positions], padding=True,
                                    truncation=True, max_length=8192, return_tensors="np")
            embeddings = self.model(**{k: self.mx.array(v) for k, v in inputs.items()}).text_embeds
            self.mx.eval(embeddings)
            outputs.append(np.array(embeddings.astype(self.mx.float32)))
        merged = np.concatenate(outputs)
        return merged[np.argsort(order)]


def validate_fixture(fixture):
    ids = [d["id"] for d in fixture["documents"]]
    assert len(set(ids)) == len(ids), "Corpus IDs must be unique"
    case_ids = [c["id"] for c in fixture["cases"]]
    assert len(set(case_ids)) == len(case_ids), "Query IDs must be unique"
    for case in fixture["cases"]:
        assert case["expected"] in ids, case["id"]
        if case.get("word"):
            candidates = [d for d in fixture["documents"] if d.get("word") == case["word"]]
            assert len(candidates) >= 2 and case["expected"] in [d["id"] for d in candidates], case["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="google/embeddinggemma-2")
    parser.add_argument("--backend", choices=["torch", "mlx"], default="torch")
    parser.add_argument("--revision", required=True, help="Exact 40-character model commit")
    parser.add_argument("--device", choices=["mps", "cpu"], default="mps")
    parser.add_argument("--dtype", choices=["bfloat16", "float32"], default="bfloat16")
    parser.add_argument("--mlx-cache-mib", type=int, help="Optional MLX allocator cache cap; does not limit active tensors")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=3)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision):
        parser.error("--revision must be an exact 40-character model commit")
    if args.backend == "torch":
        import torch
        from sentence_transformers import SentenceTransformer
        runtime = torch
        if args.device == "mps" and not torch.backends.mps.is_available():
            parser.error("MPS is unavailable; pass --device cpu --dtype float32")
        torch.set_num_threads(4)
    else:
        import mlx.core as mx
        runtime = mx
        if args.mlx_cache_mib is not None:
            if args.mlx_cache_mib < 0:
                parser.error("--mlx-cache-mib must be nonnegative")
            mx.set_cache_limit(args.mlx_cache_mib * 1024 * 1024)
    if args.rounds < 1:
        parser.error("--rounds must be positive")
    fixture_path = ROOT / "tests/quality/embedding-tech-cases.json"
    source = fixture_path.read_bytes()
    fixture = json.loads(source)
    validate_fixture(fixture)
    documents, cases = fixture["documents"], fixture["cases"]
    # Resolve/download before measuring load; cache contents do not count as model startup.
    snapshot = Path(snapshot_download(args.model, revision=args.revision))
    sampler = MemorySampler(args.device if args.backend == "torch" else "mlx", runtime)
    before = sampler.sample()
    sampler.thread.start()

    def synchronize():
        if args.backend == "mlx":
            runtime.synchronize()
        elif args.device == "mps":
            torch.mps.synchronize()

    def timed_encode(texts, **kwargs):
        synchronize()
        start = time.perf_counter()
        result = model.encode(texts, normalize_embeddings=True, show_progress_bar=False,
                              convert_to_numpy=True, **kwargs)
        synchronize()
        elapsed = (time.perf_counter() - start) * 1000
        if not np.isfinite(result).all():
            raise ValueError("Model returned a non-finite embedding")
        return result, elapsed

    try:
        start = time.perf_counter()
        model = MLXTextEncoder(snapshot) if args.backend == "mlx" else SentenceTransformer(
            str(snapshot), device=args.device,
            config_kwargs={"vision_config": None, "audio_config": None} if args.model == "google/embeddinggemma-2" else {},
            model_kwargs={"torch_dtype": getattr(torch, args.dtype)},
            trust_remote_code=False,
        )
        synchronize()
        load_ms = (time.perf_counter() - start) * 1000
        loaded_memory = sampler.sample()
        print(f"Loaded {args.model} in {load_ms:.0f}ms", flush=True)
        prompts = model.prompts
        search_prompt = prompts.get("SearchQuery", prompts.get("query", "task: search result | query: "))
        code_prompt = prompts.get("CodeRetrieval", "task: code retrieval | query: ")
        cold_vector, cold_ms = timed_encode([cases[0]["query"]], prompt=search_prompt, batch_size=1)
        del cold_vector
        doc_texts = [f'title: {d["title"]} | text: {d["text"]}' for d in documents]
        doc_vectors, corpus_ms = timed_encode(doc_texts, prompt="", batch_size=8)
        query_vectors = np.zeros((len(cases), doc_vectors.shape[1]), dtype=np.float32)
        query_ms = 0.0
        for category in ["text", "code"]:
            positions = [i for i, c in enumerate(cases) if (c["category"] == "code") == (category == "code")]
            vectors, elapsed = timed_encode([cases[i]["query"] for i in positions],
                                            prompt=code_prompt if category == "code" else search_prompt, batch_size=8)
            query_vectors[positions] = vectors
            query_ms += elapsed
        evaluations = {"bm25": evaluate(documents, cases, bm25_scores(documents, [c["query"] for c in cases]))}
        scoring = {}
        for dimension in [768, 512, 256, 128]:
            if dimension > doc_vectors.shape[1]:
                continue
            docs = truncate_normalize(doc_vectors, dimension)
            queries = truncate_normalize(query_vectors, dimension)
            start = time.perf_counter()
            scores = queries @ docs.T
            scoring[str(dimension)] = {
                "all_queries_ms": (time.perf_counter() - start) * 1000,
                "float32_bytes_per_document": dimension * 4,
                "float32_bytes_per_100k_documents": dimension * 4 * 100000,
            }
            evaluations[str(dimension)] = evaluate(documents, cases, scores)
        print({d: e["summary"]["all"] for d, e in evaluations.items()}, flush=True)
        warmed_memory = sampler.sample()
        # Five warmups; then 3 shuffled passes over distinct query strings. No result cache.
        for case in cases[:5]:
            timed_encode([case["query"]], prompt=search_prompt, batch_size=1)
        latencies = []
        randomizer = random.Random(20261007)
        for round_number in range(args.rounds):
            order = list(range(len(cases)))
            randomizer.shuffle(order)
            for position in order:
                case = cases[position]
                _, elapsed = timed_encode([case["query"]], batch_size=1,
                                          prompt=code_prompt if case["category"] == "code" else search_prompt)
                latencies.append({"round": round_number, "id": case["id"], "ms": elapsed})
            print(f"Completed single-query round {round_number + 1}/{args.rounds}", flush=True)
        # Fixed first 32 non-code texts, three repetitions per batch size.
        workload = [c["query"] for c in cases if c["category"] != "code"][:32]
        batch_rows = []
        for round_number in range(3):
            sizes = [1, 8, 16, 32] if round_number % 2 == 0 else [32, 16, 8, 1]
            for size in sizes:
                _, elapsed = timed_encode(workload, prompt=search_prompt, batch_size=size)
                batch_rows.append({"round": round_number, "batch_size": size, "inputs": len(workload),
                                   "ms": elapsed, "inputs_per_second": len(workload) * 1000 / elapsed})
        snapshot_files = [p for p in snapshot.rglob("*") if p.is_file()]
        result = {
            "date": datetime.now(timezone.utc).isoformat(), "model": args.model, "revision": args.revision,
            "backend": args.backend, "device": args.device if args.backend == "torch" else "mlx-metal",
            "dtype": args.dtype if args.backend == "torch" else "checkpoint quantization with BF16 activations",
            "system": platform.platform(), "machine": platform.machine(),
            "torch_cpu_threads": torch.get_num_threads() if args.backend == "torch" else None,
            "fixture_sha256": hashlib.sha256(source).hexdigest(),
            "corpus_count": len(documents), "query_count": len(cases),
            "versions": {p: importlib.metadata.version(p) for p in ["sentence-transformers", "transformers", "torch", "numpy", "psutil", "huggingface-hub"] + (["mlx", "mlx-vlm"] if args.backend == "mlx" else [])},
            "prompts": {"search": search_prompt, "code": code_prompt, "document": "title: {title} | text: {content}"},
            "active_parameters": sum(p.numel() for p in model.parameters()) if args.backend == "torch" else None,
            "active_parameter_bytes": sum(p.numel() * p.element_size() for p in model.parameters()) if args.backend == "torch" else model.weight_storage_bytes,
            "quantization": model.quantization if args.backend == "mlx" else None,
            "mlx_cache_limit_bytes": args.mlx_cache_mib * 1024 * 1024 if args.mlx_cache_mib is not None and args.backend == "mlx" else None,
            "snapshot_bytes": sum(p.stat().st_size for p in snapshot_files),
            "safetensors_bytes": sum(p.stat().st_size for p in snapshot_files if p.suffix == ".safetensors"),
            "load_from_disk_ms": load_ms, "first_query_ms": cold_ms,
            "corpus_encoding_ms": corpus_ms, "quality_queries_encoding_ms": query_ms,
            "memory": {"before_load": before, "after_load": loaded_memory, "after_quality_encoding": warmed_memory,
                       "sampled_peak": sampler.peak, "interval_ms": 20,
                       "method": "Process RSS and backend allocation counters sampled every 20ms. Not physical footprint; overlapping counters must not be added. Includes runtime and allocator caches. Weights downloaded before load. Other local services are left running."},
            "single_query_latency": {"summary": statistics([r["ms"] for r in latencies]), "runs": latencies,
                                     "method": "5 warmups then shuffled fixed queries; GPU synchronized; includes tokenization, encoder, pooling, normalization and NumPy output. No HTTP, browser rendering or result cache."},
            "batch_latency": batch_rows, "scoring": scoring, "evaluations": evaluations,
            "limitations": ["Small synthetic authored diagnostic, not random real-world accuracy or a translation test.",
                            "Sense ranking uses known matching headwords; global corpus search is reported separately.",
                            "No multimodal, energy or browser integration measured. Backend and precision shown explicitly; not a same-precision backend comparison.",
                            "Vector shortening reduces index storage, not encoder inference cost."],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        artifact = ROOT / "artifacts/embeddinggemma2"
        artifact.mkdir(parents=True, exist_ok=True)
        np.savez(artifact / f'{args.model.split("/")[-1]}-vectors.npz', documents=doc_vectors, queries=query_vectors)
        print(f"Saved {args.output}; latency {result['single_query_latency']['summary']}", flush=True)
    finally:
        sampler.stop.set()
        sampler.thread.join(timeout=2)


if __name__ == "__main__":
    main()
