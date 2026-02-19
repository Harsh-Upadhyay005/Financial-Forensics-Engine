"""
anomaly_detector.py – Detect statistical amount anomalies per account.

Flags accounts whose individual transactions deviate >N standard deviations
from their own mean transaction amount. Accounts with too few transactions
(< 5) are skipped to avoid noisy outlier detection.
"""
from __future__ import annotations

import logging
from typing import Dict, Set

import pandas as pd

from .config import AMOUNT_ANOMALY_STDDEV

log = logging.getLogger(__name__)

_MIN_TX_FOR_ANOMALY = 5  # need enough data for meaningful stats


def detect_amount_anomalies(df: pd.DataFrame) -> Set[str]:
    """
    Return account IDs that have at least one transaction whose amount is
    more than AMOUNT_ANOMALY_STDDEV standard deviations from that account's
    mean transaction size.

    Both sending and receiving sides are checked independently.
    """
    flagged: Set[str] = set()

    if df.empty:
        return flagged

    # ── Check senders ─────────────────────────────────────────────────────────
    for sender, grp in df.groupby("sender_id"):
        if len(grp) < _MIN_TX_FOR_ANOMALY:
            continue
        mean = grp["amount"].mean()
        std = grp["amount"].std()
        if std == 0:
            continue
        z_scores = ((grp["amount"] - mean) / std).abs()
        if (z_scores > AMOUNT_ANOMALY_STDDEV).any():
            flagged.add(sender)

    # ── Check receivers ───────────────────────────────────────────────────────
    for receiver, grp in df.groupby("receiver_id"):
        if len(grp) < _MIN_TX_FOR_ANOMALY:
            continue
        mean = grp["amount"].mean()
        std = grp["amount"].std()
        if std == 0:
            continue
        z_scores = ((grp["amount"] - mean) / std).abs()
        if (z_scores > AMOUNT_ANOMALY_STDDEV).any():
            flagged.add(receiver)

    log.info("Amount anomaly detection: %d accounts flagged", len(flagged))
    return flagged
