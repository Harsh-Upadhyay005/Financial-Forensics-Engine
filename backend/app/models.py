"""
models.py – Pydantic response models.
Defines the exact JSON contract the API must return.
"""
from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field


class SuspiciousAccount(BaseModel):
    account_id: str
    suspicion_score: float = Field(..., ge=0.0, le=100.0)
    detected_patterns: List[str]
    ring_id: str


class FraudRing(BaseModel):
    ring_id: str
    member_accounts: List[str]
    pattern_type: str
    risk_score: float = Field(..., ge=0.0, le=100.0)


class AnalysisSummary(BaseModel):
    total_accounts_analyzed: int
    suspicious_accounts_flagged: int
    fraud_rings_detected: int
    processing_time_seconds: float


class GraphNode(BaseModel):
    id: str
    label: str
    suspicious: bool
    tx_count: int
    total_sent: float
    total_received: float
    suspicion_score: Optional[float] = None
    detected_patterns: Optional[List[str]] = None
    ring_id: Optional[str] = None
    ring_ids: Optional[List[str]] = None


class GraphEdge(BaseModel):
    source: str
    target: str
    total_amount: float
    tx_count: int


class GraphData(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class AnalysisResult(BaseModel):
    suspicious_accounts: List[SuspiciousAccount]
    fraud_rings: List[FraudRing]
    summary: AnalysisSummary
    graph: GraphData


class ParseStats(BaseModel):
    total_rows: int
    valid_rows: int
    dropped_rows: int
    duplicate_tx_ids: int
    self_transactions: int
    negative_amounts: int
