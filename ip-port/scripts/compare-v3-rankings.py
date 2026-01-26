#!/usr/bin/env python3
"""
Compare scoring rankings: reproduce old V2 and V3 formulas, verify against exports.

Parts:
1. Component Metric Verification — verify input data matches between old exports and current data
2. Old V2 Formula Reproduction — implement old V2 additive formula, verify against exported scores
3. Old V3 Stakeholder Formula Reproduction — implement old V3 multiplicative formula, verify against exported scores
4. Ranking Comparison — apply old formulas to current data, compare with old export rankings
5. Batch Stability — how many top-N patents are retained across scoring methods
6. Score Distributions

Old V2: Additive weighted-sum, profiles: aggressive/moderate/conservative, "unified" = avg of 3
         sqrt normalization for citations, (years/15)^1.5, score/5 for LLM, year multiplier
Old V3: Multiplicative 4-factor, profiles: 6 stakeholder profiles, "consensus" = avg of 6
         tiered_continuous citations, stepped years, score5 normalization (v-1)/4, floors
New:    Additive weighted-sum, profiles: executive/aggressive/moderate/conservative/licensing/quick_wins

Usage:
  python3 scripts/compare-v3-rankings.py [--cap-cc=100]
"""

import json
import os
import csv
import math
import sys
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).parent.parent
EXPORT_DIR = Path("/Users/gmac/GrassLabel Dropbox/Grass Label Home/docs/docsxfer/uspto/analysis/exports_01212026")

# Parse args
CAP_CC = None
for arg in sys.argv[1:]:
    if arg.startswith('--cap-cc='):
        CAP_CC = int(arg.split('=')[1])
    elif arg == '--cap-cc':
        CAP_CC = 100


# =========================================================================
# DATA LOADING
# =========================================================================

def safe_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except:
        return None

def safe_int(v, default=0):
    if v is None or v == "":
        return default
    try:
        return int(float(v))
    except:
        return default


def load_old_v3_csv():
    """Old V3 export - 500 patents with multiplicative stakeholder scores."""
    path = EXPORT_DIR / "TOPRATED-2026-01-21.csv"
    patents = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            pid = row["patent_id"]
            patents[pid] = {
                "patent_id": pid,
                "title": row.get("title", "")[:60],
                "rank": int(row.get("rank", 0)),
                "years_remaining": float(row.get("years_remaining", 0) or 0),
                "forward_citations": safe_int(row.get("forward_citations")),
                "competitor_citations": safe_int(row.get("competitor_citations")),
                "competitor_count": safe_int(row.get("competitor_count")),
                "sector": row.get("sector", ""),
                # Profile scores
                "score_executive": safe_float(row.get("score_executive")) or 0,
                "score_consensus": safe_float(row.get("score_consensus")) or 0,
                "score_ip-lit-aggressive": safe_float(row.get("score_ip-lit-aggressive")) or 0,
                "score_ip-lit-balanced": safe_float(row.get("score_ip-lit-balanced")) or 0,
                "score_ip-lit-conservative": safe_float(row.get("score_ip-lit-conservative")) or 0,
                "score_licensing": safe_float(row.get("score_licensing")) or 0,
                "score_corporate-ma": safe_float(row.get("score_corporate-ma")) or 0,
                # LLM scores
                "eligibility_score": safe_float(row.get("eligibility_score")),
                "validity_score": safe_float(row.get("validity_score")),
                "claim_breadth": safe_float(row.get("claim_breadth")),
                "enforcement_clarity": safe_float(row.get("enforcement_clarity")),
                "design_around_difficulty": safe_float(row.get("design_around_difficulty")),
                "market_relevance_score": safe_float(row.get("market_relevance_score")),
                "ipr_risk_score": safe_float(row.get("ipr_risk_score")),
                "prosecution_quality_score": safe_float(row.get("prosecution_quality_score")),
            }
    return patents


def load_old_v2_csv():
    """Old V2 export - 500 patents with additive scores."""
    path = EXPORT_DIR / "TOPRATED-V2-2026-01-21.csv"
    patents = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            pid = row["patent_id"]
            patents[pid] = {
                "patent_id": pid,
                "title": row.get("title", "")[:60],
                "rank": int(row.get("rank", 0)),
                "years_remaining": float(row.get("years_remaining", 0) or 0),
                "forward_citations": safe_int(row.get("forward_citations")),
                "competitor_citations": safe_int(row.get("competitor_citations")),
                "competitor_count": safe_int(row.get("competitor_count")),
                "year_multiplier": safe_float(row.get("year_multiplier")) or 0,
                # Profile scores
                "score_unified": safe_float(row.get("score_unified")) or 0,
                "score_aggressive": safe_float(row.get("score_aggressive")) or 0,
                "score_moderate": safe_float(row.get("score_moderate")) or 0,
                "score_conservative": safe_float(row.get("score_conservative")) or 0,
                # LLM scores
                "eligibility_score": safe_float(row.get("eligibility_score")),
                "validity_score": safe_float(row.get("validity_score")),
                "claim_breadth": safe_float(row.get("claim_breadth")),
                "enforcement_clarity": safe_float(row.get("enforcement_clarity")),
                "design_around_difficulty": safe_float(row.get("design_around_difficulty")),
                "market_relevance_score": safe_float(row.get("market_relevance_score")),
                "ipr_risk_score": safe_float(row.get("ipr_risk_score")),
                "prosecution_quality_score": safe_float(row.get("prosecution_quality_score")),
            }
    return patents


def load_old_all_scored_csv():
    """Full CSV with all ~17k scored patents."""
    path = EXPORT_DIR / "all-patents-scored-v3-2026-01-21.csv"
    patents = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            pid = row["patent_id"]
            patents[pid] = {
                "patent_id": pid,
                "years_remaining": float(row.get("years_remaining", 0) or 0),
                "forward_citations": safe_int(row.get("forward_citations")),
                "competitor_citations": safe_int(row.get("competitor_citations")),
                "competitor_count": safe_int(row.get("competitor_count")),
                "score_executive": safe_float(row.get("score_executive")) or 0,
                "score_consensus": safe_float(row.get("score_consensus")) or 0,
                "eligibility_score": safe_float(row.get("eligibility_score")),
                "validity_score": safe_float(row.get("validity_score")),
                "claim_breadth": safe_float(row.get("claim_breadth")),
                "enforcement_clarity": safe_float(row.get("enforcement_clarity")),
                "design_around_difficulty": safe_float(row.get("design_around_difficulty")),
                "market_relevance_score": safe_float(row.get("market_relevance_score")),
                "ipr_risk_score": safe_float(row.get("ipr_risk_score")),
                "prosecution_quality_score": safe_float(row.get("prosecution_quality_score")),
            }
    return patents


def load_candidates():
    output_dir = PROJECT_ROOT / "output"
    files = sorted([f for f in os.listdir(output_dir)
                    if f.startswith("streaming-candidates-") and f.endswith(".json")], reverse=True)
    if not files:
        raise FileNotFoundError("No streaming-candidates file")
    with open(output_dir / files[0]) as f:
        return {c["patent_id"]: c for c in json.load(f)["candidates"]}


def load_classifications():
    output_dir = PROJECT_ROOT / "output"
    files = sorted([f for f in os.listdir(output_dir)
                    if f.startswith("citation-classification-") and f.endswith(".json")], reverse=True)
    if not files:
        return {}
    with open(output_dir / files[0]) as f:
        return {r["patent_id"]: r for r in json.load(f)["results"]}


def load_llm_scores():
    llm_dir = PROJECT_ROOT / "cache" / "llm-scores"
    scores = {}
    if not llm_dir.exists():
        return scores
    for f in llm_dir.iterdir():
        if f.suffix == ".json":
            with open(f) as fp:
                data = json.load(fp)
            scores[data.get("patent_id", f.stem)] = data
    return scores


def load_sector_damages():
    """Load sector damages config."""
    path = PROJECT_ROOT / "config" / "sector-damages.json"
    with open(path) as f:
        config = json.load(f)
    return {k: v["damages_rating"] for k, v in config["sectors"].items()}


def load_sector_assignments():
    """Load patent sector assignments from output."""
    path = PROJECT_ROOT / "output" / "patent-sector-assignments.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


def load_ipr_scores():
    """Load IPR risk scores from output/ipr/ batch files and cache/ipr-scores/ per-patent files."""
    scores = {}

    # Batch files (older, overridden by per-patent cache)
    ipr_dir = PROJECT_ROOT / "output" / "ipr"
    if ipr_dir.exists():
        files = sorted([f for f in os.listdir(ipr_dir)
                        if f.startswith("ipr-risk-check-") and f.endswith(".json")], reverse=True)
        for fname in files:
            with open(ipr_dir / fname) as f:
                data = json.load(f)
            for r in data.get("results", []):
                pid = r.get("patent_id")
                if pid and pid not in scores:
                    scores[pid] = r.get("ipr_risk_score")

    # Per-patent cache (overrides batch)
    cache_dir = PROJECT_ROOT / "cache" / "ipr-scores"
    if cache_dir.exists():
        for fname in os.listdir(cache_dir):
            if fname.endswith(".json"):
                with open(cache_dir / fname) as f:
                    data = json.load(f)
                pid = data.get("patent_id", fname.replace(".json", ""))
                scores[pid] = data.get("ipr_risk_score")

    return scores


def load_prosecution_scores():
    """Load prosecution quality scores from output/prosecution/ and cache/prosecution-scores/."""
    scores = {}

    # Batch files
    pros_dir = PROJECT_ROOT / "output" / "prosecution"
    if pros_dir.exists():
        files = sorted([f for f in os.listdir(pros_dir)
                        if f.startswith("prosecution-history-") and f.endswith(".json")], reverse=True)
        for fname in files:
            with open(pros_dir / fname) as f:
                data = json.load(f)
            for r in data.get("results", []):
                pid = r.get("patent_id")
                if pid and pid not in scores:
                    scores[pid] = r.get("prosecution_quality_score")

    # Per-patent cache (overrides batch)
    cache_dir = PROJECT_ROOT / "cache" / "prosecution-scores"
    if cache_dir.exists():
        for fname in os.listdir(cache_dir):
            if fname.endswith(".json"):
                with open(cache_dir / fname) as f:
                    data = json.load(f)
                pid = data.get("patent_id", fname.replace(".json", ""))
                scores[pid] = data.get("prosecution_quality_score")

    return scores


def load_market_relevance_scores():
    """Load market_relevance_score from combined V3 LLM analysis files."""
    scores = {}

    llm_v3_dir = PROJECT_ROOT / "output" / "llm-analysis-v3"
    if llm_v3_dir.exists():
        files = sorted([f for f in os.listdir(llm_v3_dir)
                        if f.startswith("combined-v3-") and f.endswith(".json")], reverse=True)
        for fname in files:
            with open(llm_v3_dir / fname) as f:
                data = json.load(f)
            for r in data.get("analyses", []):
                pid = r.get("patent_id")
                if pid and pid not in scores:
                    v = r.get("market_relevance_score")
                    if v is not None:
                        scores[pid] = v

    return scores


# =========================================================================
# OLD V2 FORMULA (from calculate-unified-top250-v2.ts)
# =========================================================================

def v2_normalize_sqrt(value, max_val):
    """sqrt(value) / sqrt(max)"""
    if value is None or value <= 0:
        return 0
    return min(1.0, math.sqrt(value) / math.sqrt(max_val))

def v2_normalize_linear(value, max_val):
    """value / max"""
    if value is None:
        return 0
    return min(1.0, value / max_val)

def v2_normalize_years(years):
    """(years/15)^1.5"""
    if years is None or years <= 0:
        return 0
    if years >= 15:
        return 1.0
    return (years / 15.0) ** 1.5

def v2_normalize_score(value):
    """value / 5"""
    if value is None:
        return None  # Signal: not available
    return value / 5.0

def v2_year_multiplier(years):
    """0.3 + 0.7 * (years/15)^0.8"""
    if years is None or years <= 0:
        return 0
    if years >= 15:
        return 1.0
    return 0.3 + 0.7 * ((years / 15.0) ** 0.8)


V2_PROFILES = {
    "aggressive": {
        "competitor_citations": 0.25,
        "competitor_count": 0.10,
        "forward_citations": 0.05,
        "years_remaining": 0.05,
        "eligibility_score": 0.15,
        "validity_score": 0.10,
        "claim_breadth": 0.05,
        "enforcement_clarity": 0.10,
        "market_relevance_score": 0.10,
        "ipr_risk_score": 0.025,
        "prosecution_quality_score": 0.025,
    },
    "moderate": {
        "competitor_citations": 0.15,
        "competitor_count": 0.05,
        "forward_citations": 0.10,
        "years_remaining": 0.05,
        "eligibility_score": 0.15,
        "validity_score": 0.15,
        "claim_breadth": 0.10,
        "enforcement_clarity": 0.10,
        "market_relevance_score": 0.10,
        "ipr_risk_score": 0.025,
        "prosecution_quality_score": 0.025,
    },
    "conservative": {
        "competitor_citations": 0.10,
        "competitor_count": 0.05,
        "forward_citations": 0.05,
        "years_remaining": 0.05,
        "eligibility_score": 0.20,
        "validity_score": 0.20,
        "claim_breadth": 0.10,
        "enforcement_clarity": 0.10,
        "market_relevance_score": 0.05,
        "ipr_risk_score": 0.05,
        "prosecution_quality_score": 0.05,
    },
}

# Fields that are always present (non-optional)
V2_ALWAYS_PRESENT = {"competitor_citations", "competitor_count", "forward_citations", "years_remaining"}

# LLM/optional fields that exclude weight if missing
V2_OPTIONAL_FIELDS = {
    "eligibility_score", "validity_score", "claim_breadth",
    "enforcement_clarity", "market_relevance_score",
    "ipr_risk_score", "prosecution_quality_score",
}


def v2_base_score(patent, weights, cap_cc=None):
    """Compute V2 base score (before year multiplier)."""
    score = 0
    weight_sum = 0

    cc = patent.get("competitor_citations", 0)
    if cap_cc is not None:
        cc = min(cc, cap_cc)

    # Always-present metrics
    if weights.get("competitor_citations"):
        norm = v2_normalize_sqrt(cc, 50)
        score += weights["competitor_citations"] * norm
        weight_sum += weights["competitor_citations"]

    if weights.get("competitor_count"):
        norm = v2_normalize_linear(patent.get("competitor_count", 0), 10)
        score += weights["competitor_count"] * norm
        weight_sum += weights["competitor_count"]

    if weights.get("forward_citations"):
        norm = v2_normalize_sqrt(patent.get("forward_citations", 0), 500)
        score += weights["forward_citations"] * norm
        weight_sum += weights["forward_citations"]

    if weights.get("years_remaining"):
        norm = v2_normalize_years(patent.get("years_remaining", 0))
        score += weights["years_remaining"] * norm
        weight_sum += weights["years_remaining"]

    # Optional LLM/analysis fields - only count if present
    for field in V2_OPTIONAL_FIELDS:
        w = weights.get(field, 0)
        if w and patent.get(field) is not None:
            norm = v2_normalize_score(patent[field])
            if norm is not None:
                score += w * norm
                weight_sum += w

    return (score / weight_sum * 100) if weight_sum > 0 else 0


def compute_old_v2(patent, cap_cc=None):
    """Compute old V2 unified score: avg of 3 profiles * year_multiplier."""
    scores = {}
    for name, weights in V2_PROFILES.items():
        base = v2_base_score(patent, weights, cap_cc=cap_cc)
        ym = v2_year_multiplier(patent.get("years_remaining", 0))
        scores[name] = base * ym

    scores["unified"] = sum(scores.values()) / 3.0
    scores["year_multiplier"] = v2_year_multiplier(patent.get("years_remaining", 0))
    return scores


# =========================================================================
# OLD V3 STAKEHOLDER FORMULA (from calculate-and-export-v3.ts)
# =========================================================================

def v3_normalize(value, config, default=0):
    """Generic V3 normalization."""
    v = value if value is not None else default

    ntype = config["type"]

    if ntype == "linear":
        return min(1.0, max(0, v / config.get("max", 1)))

    elif ntype == "sqrt":
        return min(1.0, math.sqrt(max(0, v)) / math.sqrt(config.get("max", 1)))

    elif ntype == "log":
        if v <= 0:
            return 0
        return min(1.0, math.log(v + 1) / math.log(config.get("max", 100) + 1))

    elif ntype == "stepped":
        steps = sorted(config["steps"], key=lambda s: s["threshold"], reverse=True)
        for step in steps:
            if v >= step["threshold"]:
                return step["value"]
        return 0

    elif ntype == "tiered_continuous":
        for tier in config["tiers"]:
            if v >= tier["min"] and v < tier["max"]:
                progress = (v - tier["min"]) / (tier["max"] - tier["min"])
                return tier["baseValue"] + progress * tier["slope"]
        last_tier = config["tiers"][-1]
        if v >= last_tier["max"]:
            return last_tier["baseValue"] + last_tier["slope"]
        return 0

    elif ntype == "score5":
        return max(0, min(1.0, (v - 1) / 4.0))

    return v


# Citation normalization configs
CITATIONS_AGGRESSIVE = {
    "type": "tiered_continuous",
    "tiers": [
        {"min": 0, "max": 1, "baseValue": 0.005, "slope": 0.145},
        {"min": 1, "max": 3, "baseValue": 0.15, "slope": 0.35},
        {"min": 3, "max": 8, "baseValue": 0.50, "slope": 0.25},
        {"min": 8, "max": 20, "baseValue": 0.75, "slope": 0.18},
        {"min": 20, "max": 100, "baseValue": 0.93, "slope": 0.07},
    ]
}

CITATIONS_STANDARD = {
    "type": "tiered_continuous",
    "tiers": [
        {"min": 0, "max": 1, "baseValue": 0.01, "slope": 0.14},
        {"min": 1, "max": 3, "baseValue": 0.15, "slope": 0.30},
        {"min": 3, "max": 8, "baseValue": 0.45, "slope": 0.25},
        {"min": 8, "max": 20, "baseValue": 0.70, "slope": 0.20},
        {"min": 20, "max": 100, "baseValue": 0.90, "slope": 0.10},
    ]
}

YEARS_LITIGATION = {
    "type": "stepped",
    "steps": [
        {"threshold": 10, "value": 1.00},
        {"threshold": 7, "value": 0.85},
        {"threshold": 5, "value": 0.60},
        {"threshold": 4, "value": 0.40},
        {"threshold": 3, "value": 0.25},
        {"threshold": 0, "value": 0.10},
    ]
}

SCORE5 = {"type": "score5"}

V3_PROFILES = [
    {
        "id": "ip-lit-aggressive",
        "factors": [
            {
                "name": "MarketOpportunity", "floor": 0.02,
                "metrics": [
                    {"field": "competitor_citations", "weight": 0.60, "normalize": CITATIONS_AGGRESSIVE},
                    {"field": "competitor_count", "weight": 0.20, "normalize": {"type": "sqrt", "max": 10}},
                    {"field": "forward_citations", "weight": 0.08, "normalize": {"type": "sqrt", "max": 400}},
                    {"field": "market_relevance_score", "weight": 0.12, "normalize": SCORE5, "default": 3.2},
                ]
            },
            {
                "name": "LegalMerit", "floor": 0.15,
                "metrics": [
                    {"field": "eligibility_score", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "validity_score", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "claim_breadth", "weight": 0.15, "normalize": SCORE5, "default": 3.0},
                    {"field": "prosecution_quality_score", "weight": 0.15, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "CollectionYield", "floor": 0.20,
                "metrics": [
                    {"field": "enforcement_clarity", "weight": 0.40, "normalize": SCORE5, "default": 3.0},
                    {"field": "design_around_difficulty", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "ipr_risk_score", "weight": 0.25, "normalize": SCORE5, "default": 4.0},
                ]
            },
            {
                "name": "Timeline", "floor": 0.12,
                "metrics": [
                    {"field": "years_remaining", "weight": 1.0, "normalize": YEARS_LITIGATION},
                ]
            },
        ]
    },
    {
        "id": "ip-lit-balanced",
        "factors": [
            {
                "name": "MarketEvidence", "floor": 0.012,
                "metrics": [
                    {"field": "competitor_citations", "weight": 0.75, "normalize": CITATIONS_AGGRESSIVE},
                    {"field": "competitor_count", "weight": 0.15, "normalize": {"type": "linear", "max": 8}},
                    {"field": "market_relevance_score", "weight": 0.10, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "LegalStrength", "floor": 0.17,
                "metrics": [
                    {"field": "eligibility_score", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                    {"field": "validity_score", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                    {"field": "claim_breadth", "weight": 0.20, "normalize": SCORE5, "default": 3.0},
                    {"field": "prosecution_quality_score", "weight": 0.20, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "EnforcementViability", "floor": 0.25,
                "metrics": [
                    {"field": "enforcement_clarity", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "design_around_difficulty", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                    {"field": "ipr_risk_score", "weight": 0.35, "normalize": SCORE5, "default": 4.0},
                ]
            },
            {
                "name": "TimelineValue", "floor": 0.15,
                "metrics": [
                    {"field": "years_remaining", "weight": 1.0, "normalize": YEARS_LITIGATION},
                ]
            },
        ]
    },
    {
        "id": "ip-lit-conservative",
        "factors": [
            {
                "name": "LegalFoundation", "floor": 0.30,
                "metrics": [
                    {"field": "eligibility_score", "weight": 0.30, "normalize": SCORE5, "default": 2.8},
                    {"field": "validity_score", "weight": 0.30, "normalize": SCORE5, "default": 2.8},
                    {"field": "prosecution_quality_score", "weight": 0.25, "normalize": SCORE5, "default": 2.8},
                    {"field": "claim_breadth", "weight": 0.15, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "MarketValidation", "floor": 0.05,
                "metrics": [
                    {"field": "competitor_citations", "weight": 0.65, "normalize": CITATIONS_STANDARD},
                    {"field": "competitor_count", "weight": 0.20, "normalize": {"type": "linear", "max": 8}},
                    {"field": "forward_citations", "weight": 0.15, "normalize": {"type": "sqrt", "max": 300}},
                ]
            },
            {
                "name": "RiskMitigation", "floor": 0.35,
                "metrics": [
                    {"field": "ipr_risk_score", "weight": 0.40, "normalize": SCORE5, "default": 3.5},
                    {"field": "enforcement_clarity", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "design_around_difficulty", "weight": 0.25, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "TimelineMargin", "floor": 0.20,
                "metrics": [
                    {"field": "years_remaining", "weight": 1.0, "normalize": {
                        "type": "stepped",
                        "steps": [
                            {"threshold": 12, "value": 1.00},
                            {"threshold": 9, "value": 0.85},
                            {"threshold": 7, "value": 0.65},
                            {"threshold": 5, "value": 0.40},
                            {"threshold": 3, "value": 0.20},
                            {"threshold": 0, "value": 0.10},
                        ]
                    }},
                ]
            },
        ]
    },
    {
        "id": "licensing",
        "factors": [
            {
                "name": "LicenseePool", "floor": 0.05,
                "metrics": [
                    {"field": "competitor_citations", "weight": 0.45, "normalize": CITATIONS_STANDARD},
                    {"field": "competitor_count", "weight": 0.30, "normalize": {"type": "sqrt", "max": 10}},
                    {"field": "forward_citations", "weight": 0.25, "normalize": {"type": "sqrt", "max": 400}},
                ]
            },
            {
                "name": "NegotiationLeverage", "floor": 0.20,
                "metrics": [
                    {"field": "claim_breadth", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                    {"field": "design_around_difficulty", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                    {"field": "enforcement_clarity", "weight": 0.25, "normalize": SCORE5, "default": 3.0},
                    {"field": "ipr_risk_score", "weight": 0.15, "normalize": SCORE5, "default": 4.0},
                ]
            },
            {
                "name": "Credibility", "floor": 0.20,
                "metrics": [
                    {"field": "eligibility_score", "weight": 0.40, "normalize": SCORE5, "default": 3.0},
                    {"field": "validity_score", "weight": 0.40, "normalize": SCORE5, "default": 3.0},
                    {"field": "prosecution_quality_score", "weight": 0.20, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "TermValue", "floor": 0.20,
                "metrics": [
                    {"field": "years_remaining", "weight": 1.0, "normalize": {
                        "type": "stepped",
                        "steps": [
                            {"threshold": 8, "value": 1.00},
                            {"threshold": 5, "value": 0.80},
                            {"threshold": 3, "value": 0.55},
                            {"threshold": 0, "value": 0.25},
                        ]
                    }},
                ]
            },
        ]
    },
    {
        "id": "corporate-ma",
        "factors": [
            {
                "name": "StrategicValue", "floor": 0.03,
                "metrics": [
                    {"field": "competitor_citations", "weight": 0.55, "normalize": CITATIONS_AGGRESSIVE},
                    {"field": "forward_citations", "weight": 0.25, "normalize": {"type": "sqrt", "max": 500}},
                    {"field": "competitor_count", "weight": 0.20, "normalize": {"type": "linear", "max": 10}},
                ]
            },
            {
                "name": "DefensiveStrength", "floor": 0.20,
                "metrics": [
                    {"field": "claim_breadth", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "design_around_difficulty", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "market_relevance_score", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "AssetQuality", "floor": 0.25,
                "metrics": [
                    {"field": "eligibility_score", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                    {"field": "validity_score", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                    {"field": "prosecution_quality_score", "weight": 0.20, "normalize": SCORE5, "default": 3.0},
                    {"field": "ipr_risk_score", "weight": 0.20, "normalize": SCORE5, "default": 4.0},
                ]
            },
            {
                "name": "LifecycleValue", "floor": 0.15,
                "metrics": [
                    {"field": "years_remaining", "weight": 1.0, "normalize": {
                        "type": "stepped",
                        "steps": [
                            {"threshold": 10, "value": 1.00},
                            {"threshold": 7, "value": 0.80},
                            {"threshold": 5, "value": 0.60},
                            {"threshold": 3, "value": 0.35},
                            {"threshold": 0, "value": 0.15},
                        ]
                    }},
                ]
            },
        ]
    },
    {
        "id": "executive",
        "factors": [
            {
                "name": "MarketPosition", "floor": 0.02,
                "metrics": [
                    {"field": "competitor_citations", "weight": 0.65, "normalize": CITATIONS_AGGRESSIVE},
                    {"field": "forward_citations", "weight": 0.20, "normalize": {"type": "sqrt", "max": 500}},
                    {"field": "market_relevance_score", "weight": 0.15, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "PortfolioQuality", "floor": 0.22,
                "metrics": [
                    {"field": "eligibility_score", "weight": 0.25, "normalize": SCORE5, "default": 3.0},
                    {"field": "validity_score", "weight": 0.25, "normalize": SCORE5, "default": 3.0},
                    {"field": "claim_breadth", "weight": 0.25, "normalize": SCORE5, "default": 3.0},
                    {"field": "prosecution_quality_score", "weight": 0.25, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "MonetizationPotential", "floor": 0.20,
                "metrics": [
                    {"field": "competitor_count", "weight": 0.35, "normalize": {"type": "sqrt", "max": 10}},
                    {"field": "enforcement_clarity", "weight": 0.35, "normalize": SCORE5, "default": 3.0},
                    {"field": "design_around_difficulty", "weight": 0.30, "normalize": SCORE5, "default": 3.0},
                ]
            },
            {
                "name": "AssetLongevity", "floor": 0.18,
                "metrics": [
                    {"field": "years_remaining", "weight": 1.0, "normalize": {
                        "type": "stepped",
                        "steps": [
                            {"threshold": 10, "value": 1.00},
                            {"threshold": 7, "value": 0.80},
                            {"threshold": 5, "value": 0.55},
                            {"threshold": 3, "value": 0.30},
                            {"threshold": 0, "value": 0.12},
                        ]
                    }},
                ]
            },
        ]
    },
]


def compute_v3_profile_score(patent, profile, cap_cc=None):
    """Compute V3 score for a single profile. Returns (finalScore, factorScores)."""
    factor_scores = {}

    for factor in profile["factors"]:
        weighted_sum = 0
        total_weight = 0

        for metric in factor["metrics"]:
            raw = patent.get(metric["field"])
            # Apply CC cap if needed
            if metric["field"] == "competitor_citations" and cap_cc is not None and raw is not None:
                raw = min(raw, cap_cc)
            default = metric.get("default", 0)
            normalized = v3_normalize(raw, metric["normalize"], default)
            weighted_sum += metric["weight"] * normalized
            total_weight += metric["weight"]

        score = weighted_sum / total_weight if total_weight > 0 else 0
        score = max(factor["floor"], score)
        factor_scores[factor["name"]] = score

    # Multiplicative combination
    final = 1.0
    for s in factor_scores.values():
        final *= s
    final *= 100

    return final, factor_scores


def compute_old_v3(patent, cap_cc=None):
    """Compute old V3 all profile scores and consensus."""
    profile_scores = {}
    for profile in V3_PROFILES:
        score, _ = compute_v3_profile_score(patent, profile, cap_cc=cap_cc)
        profile_scores[profile["id"]] = score

    profile_scores["consensus"] = sum(profile_scores.values()) / len(V3_PROFILES)
    return profile_scores


# =========================================================================
# NEW ENGINE FORMULA (from scoring-service.ts)
# =========================================================================

def compute_new_executive(candidate, classification, llm, cap_cc=None,
                          ipr_score=None, prosecution_score=None, market_relevance=None):
    """Replicate scoring-service.ts executive profile (with all 12 metrics)."""
    cc = classification.get("competitor_citations", 0) if classification else 0
    if cap_cc is not None:
        cc = min(cc, cap_cc)
    fc = candidate.get("forward_citations", 0)
    years = candidate.get("remaining_years", 0)
    count = classification.get("competitor_count", 0) if classification else 0

    cc_norm = min(1.0, cc / 20.0)
    fc_norm = min(1.0, math.sqrt(fc) / 30.0)
    years_norm = min(1.0, years / 15.0)
    count_norm = min(1.0, count / 5.0)

    # Weights from scoring-service.ts executive profile
    weights = {
        "competitor_citations": 0.25, "forward_citations": 0.13,
        "years_remaining": 0.17, "competitor_count": 0.08,
        "eligibility_score": 0.05, "validity_score": 0.05,
        "claim_breadth": 0.04, "enforcement_clarity": 0.04,
        "design_around_difficulty": 0.04,
        "market_relevance_score": 0.05,
        "ipr_risk_score": 0.05,
        "prosecution_quality_score": 0.05,
    }

    # Quantitative metrics (always present)
    metrics = {
        "competitor_citations": cc_norm, "years_remaining": years_norm,
        "forward_citations": fc_norm, "competitor_count": count_norm,
    }
    available_weight = sum(weights[k] for k in metrics)

    # LLM sparse metrics
    if llm:
        for field in ["eligibility_score", "validity_score", "claim_breadth",
                      "enforcement_clarity", "design_around_difficulty"]:
            v = llm.get(field, 0)
            if isinstance(v, (int, float)) and 1 <= v <= 5:
                metrics[field] = max(0, (v - 1) / 4.0)
                available_weight += weights[field]

    # market_relevance_score (from LLM V3 combined)
    if market_relevance is not None and isinstance(market_relevance, (int, float)) and 1 <= market_relevance <= 5:
        metrics["market_relevance_score"] = max(0, (market_relevance - 1) / 4.0)
        available_weight += weights["market_relevance_score"]

    # API-derived sparse metrics
    if ipr_score is not None and isinstance(ipr_score, (int, float)) and 1 <= ipr_score <= 5:
        metrics["ipr_risk_score"] = max(0, (ipr_score - 1) / 4.0)
        available_weight += weights["ipr_risk_score"]

    if prosecution_score is not None and isinstance(prosecution_score, (int, float)) and 1 <= prosecution_score <= 5:
        metrics["prosecution_quality_score"] = max(0, (prosecution_score - 1) / 4.0)
        available_weight += weights["prosecution_quality_score"]

    renorm = 1.0 / available_weight if available_weight > 0 else 1.0
    base = sum(metrics.get(k, 0) * weights[k] for k in metrics) * renorm
    years_factor = min(1.0, max(0, years) / 15.0)
    year_mult = 0.3 + 0.7 * (years_factor ** 0.8)

    return round(base * year_mult * 100, 2)


# =========================================================================
# ANALYSIS HELPERS
# =========================================================================

def spearman(ranks_a, ranks_b):
    n = len(ranks_a)
    if n < 2:
        return 0.0
    d_sq = sum((a - b) ** 2 for a, b in zip(ranks_a, ranks_b))
    return 1 - (6 * d_sq) / (n * (n ** 2 - 1))


def overlap_at_cutoff(list_a, list_b, cutoff):
    """Compute overlap between two ranked patent ID lists at given cutoff."""
    set_a = set(list_a[:cutoff])
    set_b = set(list_b[:cutoff])
    overlap = set_a & set_b
    return len(overlap), cutoff


# =========================================================================
# MAIN
# =========================================================================

def main():
    print("=" * 72)
    print("SCORING COMPARISON: Reproduce Old Formulas & Verify Rankings")
    print("=" * 72)
    if CAP_CC is not None:
        print(f"  Competitor citation cap: {CAP_CC}")

    # Load everything
    print("\nLoading data...")
    old_v3 = load_old_v3_csv()
    old_v2 = load_old_v2_csv()
    old_all = load_old_all_scored_csv()
    candidates = load_candidates()
    classifications = load_classifications()
    llm_scores = load_llm_scores()
    ipr_scores = load_ipr_scores()
    prosecution_scores = load_prosecution_scores()
    market_relevance = load_market_relevance_scores()

    print(f"  Old V3 export:     {len(old_v3)} patents (multiplicative stakeholder, top 500)")
    print(f"  Old V2 export:     {len(old_v2)} patents (additive, top 500)")
    print(f"  Old all-scored:    {len(old_all)} patents (full V3 ranking)")
    print(f"  New candidates:    {len(candidates)} patents")
    print(f"  Classifications:   {len(classifications)} patents")
    print(f"  LLM scores:        {len(llm_scores)} patents")
    print(f"  IPR scores:        {len(ipr_scores)} patents")
    print(f"  Prosecution scores:{len(prosecution_scores)} patents")
    print(f"  Market relevance:  {len(market_relevance)} patents")

    # =====================================================================
    # PART 1: COMPONENT METRIC VERIFICATION
    # =====================================================================
    print(f"\n{'=' * 72}")
    print("PART 1: COMPONENT METRIC VERIFICATION")
    print(f"{'=' * 72}")
    print("Comparing raw metric values between old V3 export and current data")

    # Build new data lookup
    new_data = {}
    for pid, cand in candidates.items():
        cls = classifications.get(pid)
        llm = llm_scores.get(pid)
        new_data[pid] = {
            "competitor_citations": cls.get("competitor_citations", 0) if cls else 0,
            "forward_citations": cand.get("forward_citations", 0),
            "years_remaining": cand.get("remaining_years", 0),
            "competitor_count": cls.get("competitor_count", 0) if cls else 0,
            "eligibility_score": llm.get("eligibility_score") if llm else None,
            "validity_score": llm.get("validity_score") if llm else None,
            "claim_breadth": llm.get("claim_breadth") if llm else None,
            "enforcement_clarity": llm.get("enforcement_clarity") if llm else None,
            "design_around_difficulty": llm.get("design_around_difficulty") if llm else None,
            "market_relevance_score": market_relevance.get(pid),
            "ipr_risk_score": ipr_scores.get(pid),
            "prosecution_quality_score": prosecution_scores.get(pid),
        }

    common = set(old_v3.keys()) & set(new_data.keys())
    print(f"\nCommon patents (old V3 vs new): {len(common)} / {len(old_v3)}")

    metrics_check = {"cc": [0,0,[]], "fc": [0,0,[]], "yr": [0,0,[]], "llm": [0,0,0]}
    for pid in common:
        old = old_v3[pid]
        new = new_data[pid]

        # Competitor citations
        if old["competitor_citations"] == new["competitor_citations"]:
            metrics_check["cc"][0] += 1
        else:
            metrics_check["cc"][1] += 1
            metrics_check["cc"][2].append((pid, old["competitor_citations"], new["competitor_citations"]))

        # Forward citations
        if old["forward_citations"] == new["forward_citations"]:
            metrics_check["fc"][0] += 1
        else:
            metrics_check["fc"][1] += 1
            metrics_check["fc"][2].append((pid, old["forward_citations"], new["forward_citations"]))

        # Years remaining (within 0.5 tolerance)
        if abs(old["years_remaining"] - new["years_remaining"]) < 0.5:
            metrics_check["yr"][0] += 1
        else:
            metrics_check["yr"][1] += 1
            metrics_check["yr"][2].append((pid, old["years_remaining"], new["years_remaining"]))

    # LLM check
    llm_match = llm_diff = llm_missing = 0
    llm_fields = ["eligibility_score", "validity_score", "claim_breadth",
                   "enforcement_clarity", "design_around_difficulty"]
    for pid in common:
        old = old_v3[pid]
        new_llm = llm_scores.get(pid)
        if old["eligibility_score"] is not None and new_llm is not None:
            if all(abs((old.get(f) or 0) - (new_llm.get(f, 0))) < 0.01 for f in llm_fields if old.get(f) is not None):
                llm_match += 1
            else:
                llm_diff += 1
        else:
            llm_missing += 1

    print(f"\n  Competitor Citations: {metrics_check['cc'][0]} match, {metrics_check['cc'][1]} differ")
    if metrics_check['cc'][2]:
        print(f"    Sample diffs (largest): ", end="")
        for pid, ov, nv in sorted(metrics_check['cc'][2], key=lambda x: abs(x[1]-x[2]), reverse=True)[:3]:
            print(f"{pid}: old={ov} new={nv}", end="; ")
        print()

    print(f"  Forward Citations:   {metrics_check['fc'][0]} match, {metrics_check['fc'][1]} differ")
    print(f"  Years Remaining:     {metrics_check['yr'][0]} match (+-0.5), {metrics_check['yr'][1]} differ")
    print(f"  LLM Scores:          {llm_match} match, {llm_diff} differ, {llm_missing} missing in one/both")

    # =====================================================================
    # PART 2: OLD V2 FORMULA VERIFICATION
    # =====================================================================
    print(f"\n{'=' * 72}")
    print("PART 2: OLD V2 FORMULA VERIFICATION")
    print(f"{'=' * 72}")
    print("Applying old V2 formula to OLD EXPORT data, comparing to exported scores")
    print("This verifies the Python formula implementation matches the TypeScript original")

    v2_errors = []
    v2_match_count = 0
    for pid, pat in old_v2.items():
        computed = compute_old_v2(pat, cap_cc=CAP_CC)
        exported = pat["score_unified"]
        diff = abs(computed["unified"] - exported)
        if diff < 0.5:
            v2_match_count += 1
        else:
            v2_errors.append((pid, exported, computed["unified"], diff,
                              computed["year_multiplier"], pat.get("year_multiplier", 0)))

    print(f"\n  Verified: {v2_match_count}/{len(old_v2)} unified scores match within 0.5")
    if v2_errors:
        v2_errors.sort(key=lambda x: x[3], reverse=True)
        print(f"  Mismatches: {len(v2_errors)} (showing top 5)")
        for pid, exported, computed, diff, ym_comp, ym_exp in v2_errors[:5]:
            print(f"    {pid}: exported={exported:.2f} computed={computed:.2f} diff={diff:.2f} ym_comp={ym_comp:.3f} ym_exp={ym_exp:.3f}")

    # Per-profile verification
    for pname in ["aggressive", "moderate", "conservative"]:
        match_count = 0
        for pid, pat in old_v2.items():
            computed = compute_old_v2(pat, cap_cc=CAP_CC)
            exported = pat[f"score_{pname}"]
            if abs(computed[pname] - exported) < 0.5:
                match_count += 1
        print(f"  Profile {pname:14s}: {match_count}/{len(old_v2)} match within 0.5")

    # =====================================================================
    # PART 3: OLD V3 STAKEHOLDER FORMULA VERIFICATION
    # =====================================================================
    print(f"\n{'=' * 72}")
    print("PART 3: OLD V3 STAKEHOLDER FORMULA VERIFICATION")
    print(f"{'=' * 72}")
    print("Applying old V3 formula to OLD EXPORT data, comparing to exported scores")

    v3_errors = []
    v3_match_count = 0
    for pid, pat in old_v3.items():
        computed = compute_old_v3(pat, cap_cc=CAP_CC)
        exported = pat["score_executive"]
        diff = abs(computed["executive"] - exported)
        if diff < 0.5:
            v3_match_count += 1
        else:
            v3_errors.append((pid, exported, computed["executive"], diff))

    print(f"\n  Executive score: {v3_match_count}/{len(old_v3)} match within 0.5")
    if v3_errors:
        v3_errors.sort(key=lambda x: x[3], reverse=True)
        print(f"  Mismatches: {len(v3_errors)} (showing top 5)")
        for pid, exported, computed, diff in v3_errors[:5]:
            print(f"    {pid}: exported={exported:.2f} computed={computed:.2f} diff={diff:.2f}")

    # Consensus verification
    v3_cons_match = 0
    for pid, pat in old_v3.items():
        computed = compute_old_v3(pat, cap_cc=CAP_CC)
        exported = pat["score_consensus"]
        if abs(computed["consensus"] - exported) < 0.5:
            v3_cons_match += 1
    print(f"  Consensus score: {v3_cons_match}/{len(old_v3)} match within 0.5")

    # Per-profile verification
    profile_names = ["ip-lit-aggressive", "ip-lit-balanced", "ip-lit-conservative",
                     "licensing", "corporate-ma", "executive"]
    for pname in profile_names:
        match_count = 0
        for pid, pat in old_v3.items():
            computed = compute_old_v3(pat, cap_cc=CAP_CC)
            exported = pat.get(f"score_{pname}", 0)
            if abs(computed.get(pname, 0) - exported) < 0.5:
                match_count += 1
        print(f"  Profile {pname:25s}: {match_count}/{len(old_v3)} match within 0.5")

    # =====================================================================
    # PART 4: RANKING COMPARISON WITH CURRENT DATA
    # =====================================================================
    print(f"\n{'=' * 72}")
    print("PART 4: RANKING COMPARISON (Old formulas applied to CURRENT data)")
    print(f"{'=' * 72}")
    print("Applying old V2 and V3 formulas to current streaming-candidates data")
    print("Then comparing rankings to old exports and new engine")

    # Build current-data patents with all metrics for old formulas
    current_patents = {}
    for pid, cand in candidates.items():
        cls = classifications.get(pid)
        llm = llm_scores.get(pid)

        p = {
            "patent_id": pid,
            "competitor_citations": cls.get("competitor_citations", 0) if cls else 0,
            "forward_citations": cand.get("forward_citations", 0),
            "years_remaining": cand.get("remaining_years", 0),
            "competitor_count": cls.get("competitor_count", 0) if cls else 0,
        }

        # LLM fields
        if llm:
            for f in ["eligibility_score", "validity_score", "claim_breadth",
                       "enforcement_clarity", "design_around_difficulty"]:
                v = llm.get(f)
                if isinstance(v, (int, float)) and 1 <= v <= 5:
                    p[f] = v

        # market_relevance_score (from combined V3 LLM analysis)
        mr = market_relevance.get(pid)
        if mr is not None:
            p["market_relevance_score"] = mr

        # API-derived scores
        ipr = ipr_scores.get(pid)
        if ipr is not None:
            p["ipr_risk_score"] = ipr

        pros = prosecution_scores.get(pid)
        if pros is not None:
            p["prosecution_quality_score"] = pros

        current_patents[pid] = p

    # Filter: years >= 3 (matching old export filter)
    filtered = {pid: p for pid, p in current_patents.items() if p["years_remaining"] >= 3}
    print(f"\n  Current patents (3+ years): {len(filtered)} / {len(current_patents)}")

    # Compute old V2 scores on current data
    v2_current = []
    for pid, p in filtered.items():
        scores = compute_old_v2(p, cap_cc=CAP_CC)
        v2_current.append({"patent_id": pid, "score": scores["unified"], **scores})
    v2_current.sort(key=lambda x: x["score"], reverse=True)
    v2_current_ids = [p["patent_id"] for p in v2_current]

    # Compute old V3 scores on current data
    v3_current = []
    for pid, p in filtered.items():
        scores = compute_old_v3(p, cap_cc=CAP_CC)
        v3_current.append({"patent_id": pid, "score_executive": scores["executive"],
                           "score_consensus": scores["consensus"], **scores})
    v3_current.sort(key=lambda x: x["score_consensus"], reverse=True)
    v3_current_ids = [p["patent_id"] for p in v3_current]

    # Also compute new engine scores
    new_scored = []
    for pid, cand in candidates.items():
        cls = classifications.get(pid)
        llm = llm_scores.get(pid)
        score = compute_new_executive(cand, cls, llm, cap_cc=CAP_CC,
                                      ipr_score=ipr_scores.get(pid),
                                      prosecution_score=prosecution_scores.get(pid),
                                      market_relevance=market_relevance.get(pid))
        new_scored.append({"patent_id": pid, "score": score,
                           "has_llm": llm is not None,
                           "has_ipr": pid in ipr_scores,
                           "has_prosecution": pid in prosecution_scores,
                           "has_market_relevance": pid in market_relevance,
                           "years_remaining": cand.get("remaining_years", 0)})
    new_scored.sort(key=lambda x: x["score"], reverse=True)
    new_scored_ids = [p["patent_id"] for p in new_scored]

    # Old export rankings
    old_v2_ranked_ids = [p["patent_id"] for p in sorted(old_v2.values(), key=lambda x: x["score_unified"], reverse=True)]
    old_v3_ranked_ids = [p["patent_id"] for p in sorted(old_v3.values(), key=lambda x: x["score_consensus"], reverse=True)]

    # ── Comparison Tables ──

    print(f"\n  --- Old V2 Export vs Old V2 Formula on Current Data ---")
    print(f"  (How much do rankings change when using current data with same formula?)")
    common_v2_pool = set(old_v2.keys()) & set(filtered.keys())
    # Re-rank within common pool
    v2_old_in_pool = [pid for pid in old_v2_ranked_ids if pid in common_v2_pool]
    v2_new_in_pool = sorted([p for p in v2_current if p["patent_id"] in common_v2_pool],
                             key=lambda x: x["score"], reverse=True)
    v2_new_in_pool_ids = [p["patent_id"] for p in v2_new_in_pool]

    for cutoff in [25, 50, 100, 250, 500]:
        actual = min(cutoff, len(v2_old_in_pool))
        n_overlap, _ = overlap_at_cutoff(v2_old_in_pool, v2_new_in_pool_ids, actual)
        pct = n_overlap / actual * 100 if actual > 0 else 0
        print(f"    Top {actual:>4}: {n_overlap:>4} / {actual} overlap ({pct:.0f}%)")

    print(f"\n  --- Old V3 Export vs Old V3 Formula on Current Data ---")
    common_v3_pool = set(old_v3.keys()) & set(filtered.keys())
    v3_old_in_pool = [pid for pid in old_v3_ranked_ids if pid in common_v3_pool]
    v3_new_in_pool = sorted([p for p in v3_current if p["patent_id"] in common_v3_pool],
                             key=lambda x: x["score_consensus"], reverse=True)
    v3_new_in_pool_ids = [p["patent_id"] for p in v3_new_in_pool]

    for cutoff in [25, 50, 100, 250, 500]:
        actual = min(cutoff, len(v3_old_in_pool))
        n_overlap, _ = overlap_at_cutoff(v3_old_in_pool, v3_new_in_pool_ids, actual)
        pct = n_overlap / actual * 100 if actual > 0 else 0
        print(f"    Top {actual:>4}: {n_overlap:>4} / {actual} overlap ({pct:.0f}%)")

    print(f"\n  --- Old V2 Formula (current data) vs New Engine ---")
    for cutoff in [25, 50, 100, 250, 500]:
        actual = min(cutoff, len(v2_current))
        n_overlap, _ = overlap_at_cutoff(v2_current_ids, new_scored_ids, actual)
        pct = n_overlap / actual * 100 if actual > 0 else 0
        print(f"    Top {actual:>4}: {n_overlap:>4} / {actual} overlap ({pct:.0f}%)")

    print(f"\n  --- Old V3 Formula (current data) vs New Engine ---")
    for cutoff in [25, 50, 100, 250, 500]:
        actual = min(cutoff, len(v3_current))
        n_overlap, _ = overlap_at_cutoff(v3_current_ids, new_scored_ids, actual)
        pct = n_overlap / actual * 100 if actual > 0 else 0
        print(f"    Top {actual:>4}: {n_overlap:>4} / {actual} overlap ({pct:.0f}%)")

    # ── Side-by-side top 25 ──
    print(f"\n  --- TOP 25 Side-by-Side ---")
    print(f"  {'Rank':>4}  {'Old V2(export)':>14} {'V2(current)':>14} {'Old V3(export)':>14} {'V3(current)':>14} {'New Engine':>14}")
    print(f"  {'----':>4}  {'------':>14} {'------':>14} {'------':>14} {'------':>14} {'------':>14}")

    for i in range(25):
        row = f"  {i+1:>4}"
        row += f"  {old_v2_ranked_ids[i] if i < len(old_v2_ranked_ids) else 'N/A':>14}"
        row += f"  {v2_current_ids[i] if i < len(v2_current_ids) else 'N/A':>14}"
        row += f"  {old_v3_ranked_ids[i] if i < len(old_v3_ranked_ids) else 'N/A':>14}"
        row += f"  {v3_current_ids[i] if i < len(v3_current_ids) else 'N/A':>14}"
        row += f"  {new_scored_ids[i] if i < len(new_scored_ids) else 'N/A':>14}"
        print(row)

    # =====================================================================
    # PART 5: BATCH STABILITY
    # =====================================================================
    print(f"\n{'=' * 72}")
    print("PART 5: BATCH STABILITY (old all-scored vs various methods)")
    print(f"{'=' * 72}")

    old_all_ranked = sorted(old_all.values(), key=lambda x: x["score_consensus"], reverse=True)
    old_all_ranked_ids = [p["patent_id"] for p in old_all_ranked]

    print(f"\n  Old All-Scored (V3 consensus) vs Old V3 Formula on Current Data:")
    for cutoff in [100, 250, 500, 1000]:
        actual = min(cutoff, len(old_all_ranked_ids))
        n_overlap, _ = overlap_at_cutoff(old_all_ranked_ids, v3_current_ids, actual)
        pct = n_overlap / actual * 100 if actual > 0 else 0
        print(f"    Top {actual:>4}: {n_overlap:>4} / {actual} retained ({pct:.0f}%)")

    print(f"\n  Old All-Scored (V3 consensus) vs New Engine:")
    for cutoff in [100, 250, 500, 1000]:
        actual = min(cutoff, len(old_all_ranked_ids))
        n_overlap, _ = overlap_at_cutoff(old_all_ranked_ids, new_scored_ids, actual)
        pct = n_overlap / actual * 100 if actual > 0 else 0
        print(f"    Top {actual:>4}: {n_overlap:>4} / {actual} retained ({pct:.0f}%)")

    # =====================================================================
    # PART 6: SCORE DISTRIBUTIONS
    # =====================================================================
    print(f"\n{'=' * 72}")
    print("PART 6: SCORE DISTRIBUTIONS")
    print(f"{'=' * 72}")

    def print_distribution(label, scores, n=500):
        top = scores[:n]
        if not top:
            return
        print(f"\n  {label} (top {min(n, len(top))}):")
        print(f"    Max:  {top[0]:.2f}")
        if len(top) >= 50:
            print(f"    P10:  {top[49]:.2f}")
        if len(top) >= 250:
            print(f"    P50:  {top[249]:.2f}")
        print(f"    Min:  {top[-1]:.2f}")
        print(f"    Avg:  {sum(top)/len(top):.2f}")

    # New engine
    new_top_scores = [p["score"] for p in new_scored[:500]]
    print_distribution("New Engine (executive, 12 metrics)", new_top_scores)
    llm_count = sum(1 for p in new_scored[:500] if p["has_llm"])
    ipr_count = sum(1 for p in new_scored[:500] if p["has_ipr"])
    pros_count = sum(1 for p in new_scored[:500] if p["has_prosecution"])
    mr_count = sum(1 for p in new_scored[:500] if p["has_market_relevance"])
    print(f"    LLM:  {llm_count}/500  IPR: {ipr_count}/500  Prosecution: {pros_count}/500  MarketRel: {mr_count}/500")

    # Old V2 formula on current data
    v2_top_scores = [p["score"] for p in v2_current[:500]]
    print_distribution("Old V2 Formula (current data, unified)", v2_top_scores)

    # Old V3 formula on current data
    v3_top_scores = [p["score_consensus"] for p in v3_current[:500]]
    print_distribution("Old V3 Formula (current data, consensus)", v3_top_scores)

    # Old V3 export
    old_v3_scores = sorted([p["score_consensus"] for p in old_v3.values()], reverse=True)
    print_distribution("Old V3 Export (consensus)", old_v3_scores)

    # Old V2 export
    old_v2_scores = sorted([p["score_unified"] for p in old_v2.values()], reverse=True)
    print_distribution("Old V2 Export (unified)", old_v2_scores)

    # =====================================================================
    # PART 7: DATA COVERAGE IMPACT
    # =====================================================================
    print(f"\n{'=' * 72}")
    print("PART 7: DATA COVERAGE ANALYSIS")
    print(f"{'=' * 72}")

    # How many of old top patents have LLM scores in new system?
    old_v3_top100 = set(old_v3_ranked_ids[:100])
    old_v3_top250 = set(old_v3_ranked_ids[:250])
    new_llm_pids = set(llm_scores.keys())
    new_ipr_pids = set(ipr_scores.keys())
    new_pros_pids = set(prosecution_scores.keys())
    new_mr_pids = set(market_relevance.keys())

    print(f"\n  Score coverage of old V3 top patents:")
    print(f"    {'':30s} {'Top 100':>10} {'Top 250':>10}")
    print(f"    {'LLM core (5 metrics)':30s} {len(old_v3_top100 & new_llm_pids):>6}/{len(old_v3_top100):<4} {len(old_v3_top250 & new_llm_pids):>6}/{len(old_v3_top250)}")
    print(f"    {'market_relevance_score':30s} {len(old_v3_top100 & new_mr_pids):>6}/{len(old_v3_top100):<4} {len(old_v3_top250 & new_mr_pids):>6}/{len(old_v3_top250)}")
    print(f"    {'ipr_risk_score':30s} {len(old_v3_top100 & new_ipr_pids):>6}/{len(old_v3_top100):<4} {len(old_v3_top250 & new_ipr_pids):>6}/{len(old_v3_top250)}")
    print(f"    {'prosecution_quality_score':30s} {len(old_v3_top100 & new_pros_pids):>6}/{len(old_v3_top100):<4} {len(old_v3_top250 & new_pros_pids):>6}/{len(old_v3_top250)}")

    # Current data metric availability
    has_market = sum(1 for p in filtered.values() if p.get("market_relevance_score") is not None)
    has_ipr = sum(1 for p in filtered.values() if p.get("ipr_risk_score") is not None)
    has_pros = sum(1 for p in filtered.values() if p.get("prosecution_quality_score") is not None)
    has_llm = sum(1 for p in filtered.values() if p.get("eligibility_score") is not None)

    print(f"\n  Current data metric availability (of {len(filtered)} patents with 3+ years):")
    print(f"    LLM core scores:           {has_llm:>5} ({has_llm/len(filtered)*100:.1f}%)")
    print(f"    market_relevance_score:     {has_market:>5} ({has_market/len(filtered)*100:.1f}%)")
    print(f"    ipr_risk_score:             {has_ipr:>5} ({has_ipr/len(filtered)*100:.1f}%)")
    print(f"    prosecution_quality_score:  {has_pros:>5} ({has_pros/len(filtered)*100:.1f}%)")

    # New engine top-N coverage
    print(f"\n  New engine top-N metric coverage:")
    for cutoff in [50, 100, 250, 500]:
        top = new_scored[:cutoff]
        n_llm = sum(1 for p in top if p["has_llm"])
        n_ipr = sum(1 for p in top if p["has_ipr"])
        n_pros = sum(1 for p in top if p["has_prosecution"])
        n_mr = sum(1 for p in top if p["has_market_relevance"])
        print(f"    Top {cutoff:>4}: LLM={n_llm}/{cutoff} IPR={n_ipr}/{cutoff} Prosecution={n_pros}/{cutoff} MarketRel={n_mr}/{cutoff}")

    print()
    print("  NOTE: Old V3 (multiplicative) uses default values for missing LLM/analysis scores.")
    print("  Old V2 and New Engine use weight redistribution (exclude missing, renormalize).")
    print("  New engine now includes 12 metrics: 4 quantitative + 6 LLM + 2 API-derived.")


if __name__ == "__main__":
    main()
