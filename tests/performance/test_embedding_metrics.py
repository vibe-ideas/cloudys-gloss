"""Verify retrieval measurements before interpreting a local model benchmark."""
import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("benchmark_embeddings", Path(__file__).with_name("benchmark-embeddings.py"))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class RetrievalMeasurementTests(unittest.TestCase):
    def test_global_search_and_same_headword_selection_report_different_results(self):
        """候选义项选对但全库被其他词超过时，两种排名应分别报告。"""
        documents = [
            {"id": "power", "word": "transformer"},
            {"id": "language", "word": "transformer"},
            {"id": "other", "word": "attention"},
        ]
        cases = [{"id": "context", "scenario": "语言模型中的 transformer 应选神经网络义项", "category": "sense",
                  "word": "transformer", "query": "a transformer decodes words", "expected": "language"}]
        result = benchmark.evaluate(documents, cases, np.array([[0.1, 0.8, 0.9]]))
        self.assertEqual(result["cases"][0]["rank"], 2)
        self.assertEqual(result["cases"][0]["sense_rank"], 1)
        self.assertEqual(result["summary"]["all"]["hit1"], 0)
        self.assertEqual(result["summary"]["sense"]["same_headword_hit1"], 1)

    def test_shortened_vectors_are_renormalized_before_cosine_ranking(self):
        """截短后长度不同的向量应按方向相似度比较。"""
        vectors = np.array([[3.0, 4.0, 9.0], [6.0, 8.0, 1.0]])
        normalized = benchmark.truncate_normalize(vectors, 2)
        np.testing.assert_allclose(np.linalg.norm(normalized, axis=1), [1, 1])
        np.testing.assert_allclose(normalized[0], normalized[1])

    def test_zero_or_nan_vectors_stop_the_benchmark_instead_of_producing_rankings(self):
        """无效输出应终止测量，避免把 NaN 排名记为模型质量。"""
        for vectors in [np.array([[0.0, 0.0]]), np.array([[float("nan"), 1.0]])]:
            with self.subTest(vectors=vectors):
                with self.assertRaises(ValueError):
                    benchmark.truncate_normalize(vectors, 2)

    def test_bm25_zero_overlap_ties_are_visible_and_reproducible(self):
        """中文查询与纯英文词库无词面交集时，基线应保留零分和稳定排序。"""
        documents = [{"id": "first", "title": "Memory", "text": "Computer working storage"},
                     {"id": "second", "title": "Network", "text": "Data communication"}]
        scores = benchmark.bm25_scores(documents, ["中文未知问题"])
        np.testing.assert_equal(scores, [[0.0, 0.0]])
        cases = [{"id": "chinese", "scenario": "无词面交集时零分并列", "category": "cross-language",
                  "query": "中文未知问题", "expected": "second"}]
        result = benchmark.evaluate(documents, cases, scores)
        self.assertEqual(result["cases"][0]["rank"], 2)
        self.assertEqual(result["cases"][0]["top3"][0]["score"], 0)

    def test_fixed_technology_cases_have_unique_queries_and_valid_relevant_candidates(self):
        """固定科技用例的标注必须指向存在的词条，消歧词必须有多个候选。"""
        fixture = json.loads((benchmark.ROOT / "tests/quality/embedding-tech-cases.json").read_text())
        benchmark.validate_fixture(fixture)
        self.assertEqual(len(fixture["cases"]), 48)
        self.assertEqual(len(fixture["documents"]), 48)


if __name__ == "__main__":
    unittest.main(verbosity=2)
