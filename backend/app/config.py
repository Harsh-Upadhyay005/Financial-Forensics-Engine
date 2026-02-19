"""
config.py – Centralised configuration via environment variables.
All tunable thresholds live here so nothing is scattered across modules.
"""
import os


# ── File limits ────────────────────────────────────────────────────────────────
MAX_FILE_SIZE_MB: int = int(os.getenv("MAX_FILE_SIZE_MB", "20"))
MAX_FILE_SIZE_BYTES: int = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_ROWS: int = int(os.getenv("MAX_ROWS", "10000"))

# ── Cycle detection ────────────────────────────────────────────────────────────
CYCLE_MIN_LEN: int = 3
CYCLE_MAX_LEN: int = 5
MAX_CYCLES: int = int(os.getenv("MAX_CYCLES", "5000"))
CYCLE_TIMEOUT_SECONDS: float = float(os.getenv("CYCLE_TIMEOUT_SECONDS", "20.0"))

# ── Smurfing detection ─────────────────────────────────────────────────────────
FAN_THRESHOLD: int = int(os.getenv("FAN_THRESHOLD", "10"))
SMURF_WINDOW_HOURS: int = int(os.getenv("SMURF_WINDOW_HOURS", "72"))
# Accounts in BOTH top-N% sending AND receiving are excluded as high-volume merchants
HIGH_VOL_PERCENTILE: float = float(os.getenv("HIGH_VOL_PERCENTILE", "0.98"))
HIGH_VOL_MIN_ACCOUNTS: int = int(os.getenv("HIGH_VOL_MIN_ACCOUNTS", "50"))

# ── Shell detection ────────────────────────────────────────────────────────────
SHELL_MAX_TX: int = int(os.getenv("SHELL_MAX_TX", "3"))
SHELL_MIN_CHAIN: int = 3
SHELL_MAX_CHAIN: int = int(os.getenv("SHELL_MAX_CHAIN", "6"))
MAX_SHELL_CHAINS: int = int(os.getenv("MAX_SHELL_CHAINS", "1000"))

# ── Scoring ────────────────────────────────────────────────────────────────────
# Base pattern contribution scores
SCORE_CYCLE_3: float = 35.0
SCORE_CYCLE_4: float = 30.0
SCORE_CYCLE_5: float = 25.0
SCORE_FAN_IN: float = 28.0
SCORE_FAN_OUT: float = 28.0
SCORE_SHELL: float = 22.0
SCORE_HIGH_VELOCITY: float = 15.0
SCORE_MULTI_RING_BONUS: float = 10.0   # bonus per extra ring membership beyond 1
SCORE_CENTRALITY_MAX: float = 10.0     # max bonus from betweenness centrality
HIGH_VELOCITY_TX_PER_DAY: float = float(os.getenv("HIGH_VELOCITY_TX_PER_DAY", "5.0"))

# ── Risk weights for fraud_rings ───────────────────────────────────────────────
RING_RISK: dict = {
    "cycle_length_3": 95.0,
    "cycle_length_4": 88.0,
    "cycle_length_5": 80.0,
    "fan_in":  75.0,
    "fan_out": 75.0,
    "shell_chain": 70.0,
}
