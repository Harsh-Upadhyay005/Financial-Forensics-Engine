"""
smurf_detector.py – Detect smurfing patterns (fan-in / fan-out).

Smurfing (structuring)
-----------------------
  Fan-in  : 10+ unique senders → 1 receiver within a 72-hour sliding window.
  Fan-out : 1 sender → 10+ unique receivers within a 72-hour sliding window.

False-positive control
-----------------------
Legitimate high-volume merchants and payroll processors exhibit BOTH high
sent AND high received counts. We exclude only accounts that rank in the
top HIGH_VOL_PERCENTILE of BOTH dimensions simultaneously. Pure aggregators
(many-in, few-out) are intentionally NOT excluded.

Performance
-----------
Two-pointer sliding window: O(n) per group instead of O(n²).
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import List, Dict

import pandas as pd

from .config import (
    FAN_THRESHOLD,
    SMURF_WINDOW_HOURS,
    HIGH_VOL_PERCENTILE,
    HIGH_VOL_MIN_ACCOUNTS,
)

log = logging.getLogger(__name__)


def _compute_high_volume_accounts(df: pd.DataFrame) -> set:
    """
    Build the exclusion set of clear high-volume merchant / payroll accounts.
    Only accounts ranked >= HIGH_VOL_PERCENTILE in BOTH sending AND receiving
    are excluded.
    """
    send_counts = df["sender_id"].value_counts()
    recv_counts = df["receiver_id"].value_counts()
    all_accounts = set(send_counts.index) | set(recv_counts.index)

    if len(all_accounts) < HIGH_VOL_MIN_ACCOUNTS:
        return set()

    send_thresh = float(send_counts.quantile(HIGH_VOL_PERCENTILE))
    recv_thresh = float(recv_counts.quantile(HIGH_VOL_PERCENTILE))

    excluded = {
        acc for acc in all_accounts
        if send_counts.get(acc, 0) >= send_thresh
        and recv_counts.get(acc, 0) >= recv_thresh
    }
    if excluded:
        log.info("High-volume exclusion: %d accounts skipped", len(excluded))
    return excluded


def _sliding_window_unique(
    sorted_times: list,
    sorted_counterparts: list,
    hub: str,
    window_td: timedelta,
    threshold: int,
) -> tuple:
    """
    Two-pointer sliding window to find any window with >= threshold unique
    counterparties (excluding `hub` itself).

    Returns (triggered: bool, unique_counterparts: set)
    """
    n = len(sorted_times)
    if n < threshold:
        return False, set()

    left = 0
    window: dict = {}

    for right in range(n):
        cp = sorted_counterparts[right]
        if cp != hub:
            window[cp] = window.get(cp, 0) + 1

        while sorted_times[right] - sorted_times[left] > window_td:
            lcp = sorted_counterparts[left]
            if lcp != hub:
                window[lcp] -= 1
                if window[lcp] == 0:
                    del window[lcp]
            left += 1

        if len(window) >= threshold:
            return True, set(window.keys())

    return False, set()


def detect_smurfing(df: pd.DataFrame) -> List[Dict]:
    """
    Detect fan-in and fan-out smurfing patterns.

    Returns
    -------
    List of ring dicts with keys:
        members  : list[str]  – all involved accounts
        pattern  : str        – "fan_in" or "fan_out"
        hub      : str        – the central aggregator/disperser
        hub_type : str        – "aggregator" | "disperser"
    """
    rings: List[Dict] = []
    seen_keys: set = set()
    window_td = timedelta(hours=SMURF_WINDOW_HOURS)
    excluded = _compute_high_volume_accounts(df)
    df_s = df.sort_values("timestamp")

# ── Fan-in: many senders → one receiver ────────────────────────────────
    for receiver, grp in df_s.groupby("receiver_id"):
        if receiver in excluded:
            continue
        grp = grp.sort_values("timestamp")
        times   = grp["timestamp"].tolist()
        senders = grp["sender_id"].tolist()

        triggered, window_senders = _sliding_window_unique(
            times, senders, receiver, window_td, FAN_THRESHOLD
        )
        if triggered:
            key = ("fan_in", receiver)
            if key not in seen_keys:
                seen_keys.add(key)
                members = sorted(window_senders) + [receiver]
                rings.append({
                    "members": members,
                    "pattern": "fan_in",
                    "hub": receiver,
                    "hub_type": "aggregator",
                    "member_count": len(members),
                })

    # ── Fan-out: one sender → many receivers ────────────────────────────────
    for sender, grp in df_s.groupby("sender_id"):
        if sender in excluded:
            continue
        grp = grp.sort_values("timestamp")
        times     = grp["timestamp"].tolist()
        receivers = grp["receiver_id"].tolist()

        triggered, window_receivers = _sliding_window_unique(
            times, receivers, sender, window_td, FAN_THRESHOLD
        )
        if triggered:
            key = ("fan_out", sender)
            if key not in seen_keys:
                seen_keys.add(key)
                members = [sender] + sorted(window_receivers)
                rings.append({
                    "members": members,
                    "pattern": "fan_out",
                    "hub": sender,
                    "hub_type": "disperser",
                    "member_count": len(members),
                })

    log.info("Smurfing detection: %d rings found (fan-in + fan-out)", len(rings))
    return rings
