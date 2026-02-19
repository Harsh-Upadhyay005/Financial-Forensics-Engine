"""
formatter.py – Produce the final API response in exact spec format.

JSON contract (spec-compliant)
------------------------------
{
  "suspicious_accounts": [{account_id, suspicion_score, detected_patterns, ring_id}],
  "fraud_rings":         [{ring_id, member_accounts, pattern_type, risk_score}],
  "summary":            {total_accounts_analyzed, suspicious_accounts_flagged,
                          fraud_rings_detected, processing_time_seconds},
  "graph":              {nodes: [...], edges: [...]},
  "parse_stats":         {...}   // extra diagnostic info (optional)
}

All scores rounded to 1 decimal place. suspicious_accounts sorted descending.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

import networkx as nx

from .config import RING_RISK

log = logging.getLogger(__name__)

# Graph visualisation cap: if > this many nodes, strip edge transaction lists
# to keep the JSON payload manageable.
_GRAPH_PAYLOAD_NODE_CAP = 2000


def _risk_score(ring: Dict) -> float:
    """
    Calculate fraud ring risk score.
    Base value from config.RING_RISK, scaled slightly by member count.
    """
    base = RING_RISK.get(ring["pattern"], 65.0)
    n = len(ring["members"])
    return min(round(base + max(n - 3, 0) * 0.5, 1), 100.0)


def format_output(
    rings: List[Dict],
    account_scores: Dict[str, Dict],
    G: nx.DiGraph,
    processing_time: float,
    total_accounts: int,
    parse_stats: dict | None = None,
) -> Dict[str, Any]:
    """
    Build the complete API response.

    Parameters
    ----------
    rings           : merged ring list (each has ring_id, members, pattern)
    account_scores  : output of scoring.calculate_scores()
    G               : NetworkX DiGraph
    processing_time : elapsed wall-clock seconds
    total_accounts  : unique account count from the raw CSV
    parse_stats     : optional parse diagnostic info
    """
    # 1. Fraud rings
    fraud_rings: List[Dict] = []
    for ring in rings:
        fraud_rings.append({
            "ring_id":         ring["ring_id"],
            "member_accounts": ring["members"],
            "pattern_type":    ring["pattern"],
            "risk_score":      _risk_score(ring),
        })
    fraud_rings.sort(key=lambda r: r["risk_score"], reverse=True)

    # 2. Suspicious accounts
    suspicious_accounts: List[Dict] = []
    for acc_id, d in account_scores.items():
        if d["score"] <= 0:
            continue
        ring_ids = d.get("ring_ids", [])
        primary_ring = ring_ids[0] if ring_ids else "UNASSIGNED"
        suspicious_accounts.append({
            "account_id":        acc_id,
            "suspicion_score":   d["score"],
            "detected_patterns": d["patterns"],
            "ring_id":           primary_ring,
        })
    suspicious_accounts.sort(key=lambda x: x["suspicion_score"], reverse=True)

    # 3. Graph payload
    suspicious_ids = {a["account_id"] for a in suspicious_accounts}
    large_graph = G.number_of_nodes() > _GRAPH_PAYLOAD_NODE_CAP

    nodes: List[Dict] = []
    for node, attrs in G.nodes(data=True):
        nd: Dict[str, Any] = {
            "id":             node,
            "label":          node,
            "suspicious":     node in suspicious_ids,
            "tx_count":       attrs.get("tx_count", 0),
            "total_sent":     attrs.get("total_sent", 0.0),
            "total_received": attrs.get("total_received", 0.0),
            "net_flow":       attrs.get("net_flow", 0.0),
            "sent_count":     attrs.get("sent_count", 0),
            "received_count": attrs.get("received_count", 0),
            "first_tx":       attrs.get("first_tx", ""),
            "last_tx":        attrs.get("last_tx", ""),
        }
        if node in suspicious_ids:
            acc_info = account_scores.get(node, {})
            nd["suspicion_score"]   = acc_info.get("score", 0.0)
            nd["detected_patterns"] = acc_info.get("patterns", [])
            nd["ring_id"]           = (acc_info.get("ring_ids") or [""])[0]
            nd["ring_ids"]          = acc_info.get("ring_ids", [])
        nodes.append(nd)

    edges: List[Dict] = []
    for u, v, attrs in G.edges(data=True):
        ed: Dict[str, Any] = {
            "source":       u,
            "target":       v,
            "total_amount": attrs.get("total_amount", 0.0),
            "avg_amount":   attrs.get("avg_amount", 0.0),
            "tx_count":     attrs.get("tx_count", 0),
            "first_tx":     attrs.get("first_tx", ""),
            "last_tx":      attrs.get("last_tx", ""),
        }
        if not large_graph:
            ed["transactions"] = attrs.get("transactions", [])
        edges.append(ed)

    # 4. Summary
    summary: Dict[str, Any] = {
        "total_accounts_analyzed":     total_accounts,
        "suspicious_accounts_flagged": len(suspicious_accounts),
        "fraud_rings_detected":        len(fraud_rings),
        "processing_time_seconds":     round(processing_time, 3),
    }

    response: Dict[str, Any] = {
        "suspicious_accounts": suspicious_accounts,
        "fraud_rings":         fraud_rings,
        "summary":             summary,
        "graph":               {"nodes": nodes, "edges": edges},
    }
    if parse_stats:
        response["parse_stats"] = parse_stats

    log.info(
        "Format complete: %d suspicious accounts, %d fraud rings",
        len(suspicious_accounts),
        len(fraud_rings),
    )
    return response
