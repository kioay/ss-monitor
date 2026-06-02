#!/usr/bin/env python3
"""Bridge BettaFish sentiment models into ss-monitor.

Input JSON on stdin:
  {"items":[{"id":"...", "text":"..."}], "repoDir":"C:/.../BettaFish"}

Output JSON on stdout:
  {"ok": true, "engine": "...", "results": [...]}

The bridge intentionally uses BettaFish local machine-learning sentiment models
only. It does not call LLMs, remote APIs, crawlers, or browser automation.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import pickle
import re
import sys
import math
from typing import Any, Callable


class LoadedModel:
    def __init__(self, name: str, model: Any, vectorizer: Any, weight: float, kind: str):
        self.name = name
        self.model = model
        self.vectorizer = vectorizer
        self.weight = weight
        self.kind = kind


def main() -> int:
    parser = argparse.ArgumentParser(description="Run BettaFish semantic sentiment models as JSON bridge")
    parser.add_argument("--repo-dir", default="", help="BettaFish repository directory")
    parser.add_argument("--models", default="svm,bayes,xgboost", help="Comma-separated model names")
    args = parser.parse_args()

    try:
      payload = json.load(sys.stdin)
    except Exception as exc:
      return emit_error(f"Invalid JSON input: {exc}")

    repo_dir = args.repo_dir or str(payload.get("repoDir") or "")
    if not repo_dir:
      return emit_error("BettaFish repo dir is empty")

    ml_dir = os.path.join(repo_dir, "SentimentAnalysisModel", "WeiboSentiment_MachineLearning")
    if not os.path.isdir(ml_dir):
      return emit_error(f"BettaFish machine-learning sentiment directory not found: {ml_dir}")

    items = payload.get("items") or []
    if not isinstance(items, list):
      return emit_error("items must be a list")

    cwd = os.getcwd()
    sys.path.insert(0, ml_dir)
    os.chdir(ml_dir)
    try:
      with contextlib.redirect_stdout(sys.stderr):
        models = load_models(ml_dir, [name.strip().lower() for name in args.models.split(",") if name.strip()])

      if not models:
        return emit_error("No BettaFish sentiment models were loaded")

      processing = load_processing_function(ml_dir)
      results = []
      for item in items:
        if not isinstance(item, dict):
          continue
        item_id = str(item.get("id") or "")
        text = str(item.get("text") or "")
        if not item_id or not text.strip():
          continue
        results.append(predict_item(item_id, text, models, processing))

      json.dump(
        {
          "ok": True,
          "engine": "bettafish-weibo-machine-learning",
          "models": [model.name for model in models],
          "results": results,
        },
        sys.stdout,
        ensure_ascii=False,
      )
      sys.stdout.write("\n")
      return 0
    finally:
      os.chdir(cwd)


def load_models(ml_dir: str, names: list[str]) -> list[LoadedModel]:
    loaders: dict[str, tuple[str, float, str]] = {
      "svm": ("svm_model.pkl", 1.15, "sklearn"),
      "bayes": ("bayes_model.pkl", 0.9, "sklearn"),
      "xgboost": ("xgboost_model.pkl", 1.0, "xgboost"),
    }

    loaded: list[LoadedModel] = []
    for name in names:
      if name not in loaders:
        continue
      file_name, weight, kind = loaders[name]
      model_path = os.path.join(ml_dir, "model", file_name)
      if not os.path.isfile(model_path):
        print(f"Skip {name}: model file not found: {model_path}", file=sys.stderr)
        continue
      try:
        with open(model_path, "rb") as f:
          model_data = pickle.load(f)
        model = model_data.get("model")
        vectorizer = model_data.get("vectorizer")
        if model is None or vectorizer is None:
          raise ValueError("model pickle does not contain model/vectorizer")
        loaded.append(LoadedModel(name, model, vectorizer, weight, kind))
      except Exception as exc:
        print(f"Skip {name}: {exc}", file=sys.stderr)
    return loaded


def load_processing_function(ml_dir: str) -> Callable[[str], str]:
    try:
      sys.path.insert(0, ml_dir)
      from utils import processing  # type: ignore
      return processing
    except Exception as exc:
      print(f"Fallback tokenizer because BettaFish processing is unavailable: {exc}", file=sys.stderr)
      return fallback_processing


def fallback_processing(text: str) -> str:
    text = re.sub(r"\{%.+?%\}", " ", text)
    text = re.sub(r"@.+?( |$)", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return " ".join(re.findall(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]", text))


def predict_item(item_id: str, text: str, models: list[LoadedModel], processing: Callable[[str], str]) -> dict[str, Any]:
    processed = processing(text[:2000])
    votes = []
    weighted_positive = 0.0
    total_weight = 0.0

    for model in models:
      try:
        pred, confidence = predict_with_model(model, processed)
        confidence = max(0.0, min(float(confidence), 1.0))
        positive_probability = confidence if int(pred) == 1 else 1.0 - confidence
        weighted_positive += positive_probability * model.weight
        total_weight += model.weight
        votes.append(
          {
            "model": model.name,
            "label": "positive" if int(pred) == 1 else "negative",
            "confidence": round(confidence, 4),
            "positiveProbability": round(positive_probability, 4),
          }
        )
      except Exception as exc:
        votes.append({"model": model.name, "error": str(exc)})

    if total_weight <= 0:
      return {"id": item_id, "label": "unknown", "score": 0, "confidence": 0, "votes": votes}

    positive_probability = weighted_positive / total_weight
    score = (positive_probability - 0.5) * 2
    confidence = max(positive_probability, 1.0 - positive_probability)
    if positive_probability >= 0.58:
      label = "positive"
    elif positive_probability <= 0.42:
      label = "negative"
    else:
      label = "neutral"

    return {
      "id": item_id,
      "label": label,
      "score": round(score, 4),
      "confidence": round(confidence, 4),
      "positiveProbability": round(positive_probability, 4),
      "votes": votes,
    }


def predict_with_model(model: LoadedModel, processed: str) -> tuple[int, float]:
    features = model.vectorizer.transform([processed])
    if model.kind == "xgboost":
      import xgboost as xgb  # type: ignore
      probability = float(model.model.predict(xgb.DMatrix(features))[0])
      prediction = int(probability > 0.5)
      confidence = probability if prediction == 1 else 1.0 - probability
      return prediction, confidence

    if model.name == "svm" and hasattr(model.model, "decision_function"):
      decision = float(model.model.decision_function(features)[0])
      positive_probability = 1.0 / (1.0 + math.exp(-decision))
      prediction = int(positive_probability > 0.5)
      confidence = positive_probability if prediction == 1 else 1.0 - positive_probability
      return prediction, max(0.5, min(confidence, 1.0))

    prediction = int(model.model.predict(features)[0])
    if hasattr(model.model, "predict_proba"):
      try:
        probabilities = model.model.predict_proba(features)[0]
        confidence = float(max(probabilities))
        return prediction, confidence
      except Exception as exc:
        print(f"{model.name} predict_proba unavailable, falling back to decision score: {exc}", file=sys.stderr)

    if hasattr(model.model, "decision_function"):
      decision = float(model.model.decision_function(features)[0])
      positive_probability = 1.0 / (1.0 + math.exp(-decision))
      confidence = positive_probability if prediction == 1 else 1.0 - positive_probability
      return prediction, max(0.5, min(confidence, 1.0))

    confidence = 0.5
    return prediction, confidence


def emit_error(message: str) -> int:
    json.dump({"ok": False, "message": message, "results": []}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
