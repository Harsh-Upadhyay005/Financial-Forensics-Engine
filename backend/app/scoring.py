"""
scoring.py – Suspicion scoring engine.

Scoring model
-------------
1. Pattern contributions  – per ring membership (configurable weights in config.py)
2. Multi-ring bonus       – extra points per additional ring an account belongs to
3. High-velocity bonus    – accounts transacting > HIGH_VELOCITY_TX_PER_DAY per day
4. Network centrality     – small bonus based on betweenness centrality (skipped
                             for large graphs to stay within 30-second budget)

All scores are capped at 100.0 and returned sorted descending.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Set

import networkx as nx
import pandas as pd

from .config import (
    SCORE_CYCLE_3, SCORE_CYCLE_4, SCORE_CYCLE_5,
    SCORE_FAN_IN, SCORE_FAN_OUT, SCORE_SHELL,
    SCORE_HIGH_VELOCITY, SCORE_MULTI_RING_BONUS, SCORE_CENTRALITY_MAX,
    HIGH_VELOCITY_TX_PER_DAY,
)

log = logging.getLogger(__name__)

PATTERN_SCORES: Dict[str, float] = {
    "cycle_length_3": SCORE_CYCLE_3,
    "cycle_length_4": SCORE_CYCLE_4,
    "cycle_length_5": SCORE_CYCLE_5,
    "fan_in":         SCORE_FAN_IN,
    "fan_out":        SCORE_FAN_OUT,
    "shell_chain":    SCORE_SHELL,
}

# Graphs larger than this skip betweenness centrality (expensive)
_CENTRALITY_MAX_NODES = 500


def _velocity_accounts(df: pd.DataFrame) -> Set[str]:
    """Return account IDs whose average tx/day exceeds the threshold."""
    if df.empty:
        return set()
    span_days = max(
        (df["timestamp"].max() - df["timestamp"].min()).total_seconds() / 86400,
        1.0,
    )
    tx_counts = (
        pd.concat([
            df["sender_id"].value_counts(),
            df["receiver_id"].value_counts(),
        ])
        .groupby(level=0).sum()
    )
    per_day = tx_counts / span_days
    flagged = set(per_day[per_day > HIGH_VELOCITY_TX_PER_DAY].index)
    log.info("High-velocity accounts: %d", len(flagged))
    return flagged


def _centrality_scores(G: nx.DiGraph) -> Dict[str, float]:
    """
    Compute normalised betweenness centrality (0-1) for nodes.
    Returns empty dict if graph is too large to compute quickly.
    """
    if G.number_of_nodes() > _CENTRALITY_MAX_NODES:
        log.info("Graph too large for centrality computation; skipping.")
        return {}
    try:
        raw = nx.betweenness_centrality(G, normalized=True)
        return raw
    except Exception as exc:
        log.warning("Centrality computation failed: %s", exc)
        return {}


def calculate_scores(
    rings: List[Dict],
    df: pd.DataFrame,
    G: nx.DiGraph | None = None,
) -> Dict[str, Dict]:
    """
    Build a per-account suspicion score map.

    Returns
    -------
    dict mapping account_id to:
        score    : float         – 0–100, capped
        patterns : list[str]     – unique detected pattern names
        ring_ids : list[str]     – all ring IDs this account belongs to
    """
    vel_accounts = _velocity_accounts(df)
    centrality   = _centrality_scores(G) if G is not None else {}
    data: Dict[str, Dict] = {}

    def _entry(acc: str) -> Dict:
        if acc not in data:
            data[acc] = {"score": 0.0, "patterns": set(), "ring_ids": []}
        return data[acc]

    # 1. Pattern contributions
    for ring in rings:
        ring_id    = ring["ring_id"]
        pattern    = ring["pattern"]
        base_score = PATTERN_SCORES.get(pattern, 10.0)

        for acc in ring["members"]:
            e = _entry(acc)
            e["score"] += base_score
            e["patterns"].add(pattern)
            if ring_id not in e["ring_ids"]:
                e["ring_ids"].append(ring_id)

    # 2. Multi-ring bonus (account belongs to more than one ring)
    for acc, e in data.items():
        extra_rings = max(len(e["ring_ids"]) - 1, 0)
        if extra_rings > 0:
            e["score"] += SCORE_MULTI_RING_BONUS * extra_rings
            e["patterns"].add("multi_ring")

    # 3. High-velocity bonus
    for acc in vel_accounts:
        e = _entry(acc)
        e["score"] += SCORE_HIGH_VELOCITY
        e["patterns"].add("high_velocity")

    # 4. Network centrality bonus (up to SCORE_CENTRALITY_MAX points)
    if centrality:
        max_c = max(centrality.values()) if centrality else 1.0
        for acc, c_val in centrality.items():
            if acc in data:
                bonus = (c_val / max_c) * SCORE_CENTRALITY_MAX if max_c > 0 else 0
                data[acc]["score"] += bonus

    # 5. Normalise
    for acc, e in data.items():
        e["score"]    = min(round(e["score"], 1), 100.0)
        e["patterns"] = sorted(e["patterns"])   # deterministic order

    log.info("Scoring complete: %d accounts scored", len(data))
    return data
