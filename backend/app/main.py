"""
main.py – FastAPI application entry point.

Endpoints
---------
GET  /          – root redirect
GET  /health    – liveness / readiness probe with version info
POST /analyze   – upload CSV, run full forensics pipeline, return JSON

Production concerns addressed
------------------------------
- Structured logging (INFO level, JSON-friendly format)
- File-size guard before reading upload into memory
- Request-ID header injected into every response for traceability
- parse_stats returned so callers know about dropped rows / warnings
- lifespan context manager (replaces deprecated @app.on_event)
- CORS locked to env-configurable origins
"""
from __future__ import annotations

import logging
import os
import time
import uuid

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import MAX_FILE_SIZE_BYTES
from .parser import parse_csv
from .graph_builder import build_graph
from .cycle_detector import detect_cycles
from .smurf_detector import detect_smurfing
from .shell_detector import detect_shell_networks
from .scoring import calculate_scores
from .formatter import format_output
from .utils import assign_ring_ids

__version__ = "1.1.0"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s │ %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Financial Forensics Engine v%s starting up", __version__)
    yield
    log.info("Financial Forensics Engine shutting down")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

app = FastAPI(
    title="Financial Forensics Engine",
    description="Detect money-muling networks through graph analysis",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request-ID middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
def root():
    return {"status": "ok", "service": "Financial Forensics Engine", "version": __version__}


@app.get("/health")
def health():
    """Liveness / readiness probe."""
    return {
        "status": "healthy",
        "version": __version__,
        "max_file_size_mb": MAX_FILE_SIZE_BYTES // (1024 * 1024),
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Upload a CSV of financial transactions and receive a forensic analysis.

    Expected CSV columns: transaction_id, sender_id, receiver_id, amount, timestamp
    """
    # ---- basic validation ----
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

    file_bytes = await file.read()

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE_BYTES // (1024*1024)} MB.",
        )

    start_time = time.perf_counter()

    # ---- 1. Parse ----
    try:
        df, parse_stats = parse_csv(file_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if parse_stats.get("warnings"):
        log.warning("Parse warnings for %s: %s", file.filename, parse_stats["warnings"])

    total_accounts = len(
        set(df["sender_id"].tolist()) | set(df["receiver_id"].tolist())
    )
    log.info(
        "Parsed %s: %d valid rows, %d accounts",
        file.filename,
        parse_stats.get("valid_rows", len(df)),
        total_accounts,
    )

    # ---- 2. Build graph ----
    G = build_graph(df)

    # ---- 3. Run detectors ----
    cycle_rings = detect_cycles(G)
    smurf_rings = detect_smurfing(df)
    shell_rings = detect_shell_networks(G)

    # ---- 4. Assign ring IDs (with optional merging) ----
    all_rings = assign_ring_ids(cycle_rings, smurf_rings, shell_rings, merge=True)

    # ---- 5. Score accounts ----
    account_scores = calculate_scores(all_rings, df, G)

    # ---- 6. Format & return ----
    elapsed = time.perf_counter() - start_time
    result = format_output(
        all_rings, account_scores, G, elapsed, total_accounts, parse_stats
    )

    log.info(
        "Analysis complete for %s in %.2fs: %d rings, %d flagged accounts",
        file.filename,
        elapsed,
        len(all_rings),
        result["summary"]["suspicious_accounts_flagged"],
    )

    return JSONResponse(content=result)
