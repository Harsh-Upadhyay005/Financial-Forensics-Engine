"""
rapid_movement_detector.py – Detect accounts that receive and forward funds
within a very short time window (rapid pass-through behaviour).

Money mules typically receive funds and forward them within minutes to avoid
detection and account freezes. This detector finds accounts where the gap
between an incoming and a subsequent outgoing transaction is less than
RAPID_MOVEMENT_MINUTES.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Dict, Set

import pandas as pd

from .config import RAPID_MOVEMENT_MINUTES

log = logging.getLogger(__name__)


def detect_rapid_movements(df: pd.DataFrame) -> Dict[str, Dict]:
    """
    Detect accounts with short dwell times (receive → send within minutes).

    Returns
    -------
    dict mapping account_id to:
        min_dwell_minutes : float  – shortest observed dwell time
        rapid_count       : int    – number of rapid pass-through pairs
    """
    flagged: Dict[str, Dict] = {}

    if df.empty:
        return flagged

    window_td = timedelta(minutes=RAPID_MOVEMENT_MINUTES)
    df_sorted = df.sort_values("timestamp")

    # Build incoming and outgoing transaction lists per account
    incoming: Dict[str, list] = {}
    outgoing: Dict[str, list] = {}

    for _, row in df_sorted.iterrows():
        sender = row["sender_id"]
        receiver = row["receiver_id"]
        ts = row["timestamp"]

        outgoing.setdefault(sender, []).append(ts)
        incoming.setdefault(receiver, []).append(ts)

    # For each account, check if any outgoing tx follows an incoming tx
    # within the window
    all_accounts = set(incoming.keys()) & set(outgoing.keys())

    for acc in all_accounts:
        in_times = incoming[acc]
        out_times = outgoing[acc]

        min_dwell = None
        rapid_count = 0

        # Both lists are already sorted since df was sorted by timestamp
        j = 0
        for in_ts in in_times:
            # Advance j to the first outgoing tx at or after in_ts
            while j < len(out_times) and out_times[j] < in_ts:
                j += 1

            # Check subsequent outgoing transactions within window
            k = j
            while k < len(out_times):
                dwell = (out_times[k] - in_ts).total_seconds() / 60.0
                if dwell > RAPID_MOVEMENT_MINUTES:
                    break
                if dwell >= 0:
                    rapid_count += 1
                    if min_dwell is None or dwell < min_dwell:
                        min_dwell = dwell
                k += 1

        if rapid_count > 0 and min_dwell is not None:
            flagged[acc] = {
                "min_dwell_minutes": round(min_dwell, 1),
                "rapid_count": rapid_count,
            }

    log.info("Rapid movement detection: %d accounts flagged", len(flagged))
    return flagged
