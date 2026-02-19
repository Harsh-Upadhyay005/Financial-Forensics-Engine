"""
smurf_detector.py – Detect smurfing patterns (fan-in / fan-out).

Smurfing (structuring)
-----------------------
  Fan-in  : FAN_THRESHOLD+ unique senders → 1 receiver within a 72-hour window.
  Fan-out : 1 sender → FAN_THRESHOLD+ unique receivers within a 72-hour window.

False-positive control
-----------------------
We use SEPARATE unidirectional exclusion sets:
  - Fan-in  exclusion: accounts in top FAN_IN_HIGH_VOL_PERCENTILE of RECEIVE count.
    These are legitimate aggregators (Amazon, payment processors) that collect from
    many payers as a matter of normal business — NOT money-mule aggregators.
  - Fan-out exclusion: accounts in top FAN_OUT_HIGH_VOL_PERCENTILE of SEND count.
    These are legitimate disbursers (payroll processors, expense platforms) that pay
    many recipients — NOT dispersers in a smurfing scheme.

The old AND-logic (top-N% in BOTH send AND receive) caused false positives:
  Amazon  → high recv, low send  → slipped through AND check → incorrectly flagged
  Payroll → high send, low recv  → slipped through AND check → incorrectly flagged

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
    FAN_IN_HIGH_VOL_PERCENTILE,
    FAN_OUT_HIGH_VOL_PERCENTILE,
    HIGH_VOL_MIN_ACCOUNTS,
)

log = logging.getLogger(__name__)


def _excluded_fan_in_receivers(df: pd.DataFrame) -> set:
    """
    Build the exclusion set for fan-in detection.
    Any account ranked >= FAN_IN_HIGH_VOL_PERCENTILE in RECEIVE count is excluded
    (legitimate high-volume receivers: merchants, payment processors).
    """
    recv_counts = df["receiver_id"].value_counts()
    if len(recv_counts) < HIGH_VOL_MIN_ACCOUNTS:
        return set()
    recv_thresh = float(recv_counts.quantile(FAN_IN_HIGH_VOL_PERCENTILE))
    excluded = {acc for acc, cnt in recv_counts.items() if cnt >= recv_thresh}
    if excluded:
        log.info("Fan-in exclusion (high recv): %d accounts skipped", len(excluded))
    return excluded


def _excluded_fan_out_senders(df: pd.DataFrame) -> set:
    """
    Build the exclusion set for fan-out detection.
    Any account ranked >= FAN_OUT_HIGH_VOL_PERCENTILE in SEND count is excluded
    (legitimate high-volume senders: payroll, expense reimbursement systems).
    """
    send_counts = df["sender_id"].value_counts()
    if len(send_counts) < HIGH_VOL_MIN_ACCOUNTS:
        return set()
    send_thresh = float(send_counts.quantile(FAN_OUT_HIGH_VOL_PERCENTILE))
    excluded = {acc for acc, cnt in send_counts.items() if cnt >= send_thresh}
    if excluded:
        log.info("Fan-out exclusion (high send): %d accounts skipped", len(excluded))
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
    excluded_fan_in = _excluded_fan_in_receivers(df)
    excluded_fan_out = _excluded_fan_out_senders(df)
    df_s = df.sort_values("timestamp")

# ── Fan-in: many senders → one receiver ────────────────────────────────
    for receiver, grp in df_s.groupby("receiver_id"):
        if receiver in excluded_fan_in:
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
        if sender in excluded_fan_out:
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
