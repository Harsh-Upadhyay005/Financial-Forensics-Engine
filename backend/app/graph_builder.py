"""
graph_builder.py – Build a labelled directed graph from transaction data.
Uses vectorised pandas operations for fast execution on large datasets.
"""
from __future__ import annotations

import logging
from typing import Any

import networkx as nx
import pandas as pd

log = logging.getLogger(__name__)


def build_graph(df: pd.DataFrame) -> nx.DiGraph:
    """
    Construct a directed weighted graph from a validated transaction DataFrame.

    Node attributes
    ---------------
    total_sent, total_received, net_flow : float
    tx_count, sent_count, received_count : int
    avg_sent, avg_received               : float
    unique_counterparties                : int
    first_tx, last_tx                    : str

    Edge attributes
    ---------------
    total_amount, avg_amount : float
    tx_count                 : int
    first_tx, last_tx        : str
    transactions             : list[dict]
    """
    G = nx.DiGraph()

    # ── Vectorised node statistics ────────────────────────────────────────────
    sent_sum  = df.groupby("sender_id")["amount"].sum()
    sent_cnt  = df.groupby("sender_id").size()
    sent_avg  = df.groupby("sender_id")["amount"].mean()
    recv_sum  = df.groupby("receiver_id")["amount"].sum()
    recv_cnt  = df.groupby("receiver_id").size()
    recv_avg  = df.groupby("receiver_id")["amount"].mean()
    sent_cp   = df.groupby("sender_id")["receiver_id"].nunique()
    recv_cp   = df.groupby("receiver_id")["sender_id"].nunique()
    sent_first = df.groupby("sender_id")["timestamp"].min()
    sent_last  = df.groupby("sender_id")["timestamp"].max()
    recv_first = df.groupby("receiver_id")["timestamp"].min()
    recv_last  = df.groupby("receiver_id")["timestamp"].max()

    all_accounts = set(df["sender_id"].unique()) | set(df["receiver_id"].unique())

    for acc in all_accounts:
        sc  = int(sent_cnt.get(acc, 0))
        rc  = int(recv_cnt.get(acc, 0))
        ts  = round(float(sent_sum.get(acc, 0.0)), 2)
        tr  = round(float(recv_sum.get(acc, 0.0)), 2)
        sa  = round(float(sent_avg.get(acc, 0.0)), 2)
        ra  = round(float(recv_avg.get(acc, 0.0)), 2)
        scp = int(sent_cp.get(acc, 0))
        rcp = int(recv_cp.get(acc, 0))

        # Overall first / last timestamp across sent AND received
        cf = [t for t in [sent_first.get(acc), recv_first.get(acc)] if pd.notna(t)]
        cl = [t for t in [sent_last.get(acc),  recv_last.get(acc)]  if pd.notna(t)]
        first_tx = str(min(cf)) if cf else ""
        last_tx  = str(max(cl)) if cl else ""

        G.add_node(
            acc,
            total_sent=ts,
            total_received=tr,
            net_flow=round(tr - ts, 2),
            tx_count=sc + rc,
            sent_count=sc,
            received_count=rc,
            avg_sent=sa,
            avg_received=ra,
            unique_counterparties=scp + rcp,
            first_tx=first_tx,
            last_tx=last_tx,
        )

    # ── Edges ─────────────────────────────────────────────────────────────────
    for (sender, receiver), grp in df.groupby(["sender_id", "receiver_id"]):
        grp_s = grp.sort_values("timestamp")
        txns: list[dict[str, Any]] = [
            {
                "transaction_id": row["transaction_id"],
                "amount": round(float(row["amount"]), 2),
                "timestamp": str(row["timestamp"]),
            }
            for _, row in grp_s.iterrows()
        ]
        G.add_edge(
            sender,
            receiver,
            total_amount=round(float(grp["amount"].sum()), 2),
            avg_amount=round(float(grp["amount"].mean()), 2),
            tx_count=len(grp),
            first_tx=str(grp["timestamp"].min()),
            last_tx=str(grp["timestamp"].max()),
            transactions=txns,
        )

    log.info("Graph built: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges())
    return G
