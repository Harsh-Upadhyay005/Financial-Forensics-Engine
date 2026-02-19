# Financial Forensics Engine

> A production-grade web application that detects money muling networks in financial transaction data through graph analysis, statistical anomaly detection, and interactive visualization.

**Live Demo:** _[Add your deployed URL here]_  
**GitHub:** [shubhanshu2006/Financial-Forensics-Engine](https://github.com/shubhanshu2006/Financial-Forensics-Engine)

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Algorithm Approach & Complexity Analysis](#algorithm-approach--complexity-analysis)
- [Suspicion Score Methodology](#suspicion-score-methodology)
- [Installation & Setup](#installation--setup)
- [Usage Instructions](#usage-instructions)
- [JSON Output Format](#json-output-format)
- [Project Structure](#project-structure)
- [Performance Analysis](#performance-analysis)
- [Known Limitations](#known-limitations)
- [Team Members](#team-members)

---

## Tech Stack

| Layer      | Technology                    | Purpose                                              |
| ---------- | ----------------------------- | ---------------------------------------------------- |
| Backend    | **Python 3.13** / **FastAPI** | REST API, CSV parsing, analysis orchestration        |
| Graph      | **NetworkX 3.x**              | Directed graph, cycle detection, Louvain communities |
| Data       | **Pandas 3.x** / **NumPy**    | Vectorized transaction processing & statistics       |
| Validation | **Pydantic v2**               | Request/response schema validation                   |
| Frontend   | **React 18** / **Vite 5**     | Single-page application, drag-and-drop upload        |
| Viz        | **react-force-graph-2d**      | Force-directed interactive graph rendering           |
| HTTP       | **Axios**                     | API communication with 60s timeout handling          |

---

## System Architecture

```
                          ┌──────────────────────────────────┐
               CSV Upload │       FastAPI Backend v2.0       │
  Browser  ─────────────> │       POST /analyze              │
  (React)                 │                                  │
                          └──────┬───────────────────────────┘
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       │          Step 1         │                          │
       │   ┌─────────────────┐   │                          │
       │   │   parser.py     │   │   CSV → Validated DF     │
       │   └────────┬────────┘   │                          │
       │            │            │                          │
       │   Step 2   ▼            │                          │
       │   ┌─────────────────┐   │                          │
       │   │ graph_builder.py│   │   DF → NetworkX DiGraph  │
       │   └────────┬────────┘   │                          │
       │            │            │                          │
       │   Step 3   ▼ Core Detection (×4)                   │
       │   ┌─────────┬──────────┬──────────┬────────────┐   │
       │   │ cycle_  │ smurf_   │ shell_   │bidirection-│   │
       │   │detector │detector  │detector  │al_detector │   │
       │   │(Johnson)│(2-ptr    │(iter DFS)│(round-trip)│   │
       │   │         │ window)  │          │            │   │
       │   └────┬────┴────┬─────┴────┬─────┴─────┬──────┘   │
       │        │         │          │           │          │
       │   Step 4   ▼ Enrichment Detectors (×3)             │
       │   ┌──────────────┬────────────────┬─────────────┐  │
       │   │  anomaly_    │ rapid_movement │ structuring_ │  │
       │   │  detector    │ _detector      │ _detector    │  │
       │   │  (σ outlier) │ (dwell time)   │ (sub-$10K)   │  │
       │   └──────┬───────┴───────┬────────┴──────┬──────┘  │
       │          │               │               │         │
       │   Step 5 ▼                                         │
       │   ┌──────────────────────────────────────────┐     │
       │   │  utils.py → Ring merging + ID assignment │     │
       │   └──────┬───────────────────────────────────┘     │
       │          │                                         │
       │   Step 6 ▼                                         │
       │   ┌──────────────────────────────────────────┐     │
       │   │  scoring.py → Multi-factor scoring +     │     │
       │   │               risk explanations          │     │
       │   └──────┬───────────────────────────────────┘     │
       │          │                                         │
       │   Step 7 ▼                                         │
       │   ┌──────────────────────────────────────────┐     │
       │   │  formatter.py → JSON response builder    │     │
       │   │  (confidence, network stats, Louvain     │     │
       │   │   communities, temporal profiles)        │     │
       │   └──────────────────────────────────────────┘     │
       └────────────────────────────────────────────────────┘
```

### Pipeline Steps (7-Stage)

| Step | Module                    | Action                                                                         |
| ---- | ------------------------- | ------------------------------------------------------------------------------ |
| 1    | `parser.py`               | Decode CSV (UTF-8/latin-1), validate columns, clean amounts/timestamps, dedup  |
| 2    | `graph_builder.py`        | Build directed weighted graph with vectorised Pandas groupby node/edge stats   |
| 3    | Core detectors (×4)       | Cycle detection, fan-in/fan-out, shell chains, bi-directional round-trip flows |
| 4    | Enrichment detectors (×3) | Amount anomaly (3σ), rapid movement (dwell time), structuring (sub-$10K)       |
| 5    | `utils.py`                | Merge overlapping rings (≥50% member overlap), assign RING_001, RING_002, ...  |
| 6    | `scoring.py`              | Multi-factor 0–100 scoring + natural language risk explanations                |
| 7    | `formatter.py`            | Confidence scores, network statistics, Louvain communities, temporal profiles  |

---

## Algorithm Approach & Complexity Analysis

### 1. Circular Fund Routing — Cycle Detection

**What it detects:** Money flowing in loops (A → B → C → A) to obscure its criminal origin.

**Algorithm:** Johnson's algorithm via NetworkX `simple_cycles()`:

- Length filter: 3 ≤ length ≤ 5
- Canonical deduplication: each cycle is rotated to its lexicographically smallest node, so [A,B,C] and [B,C,A] are recognised as the same ring
- Threading-based timeout (20s default) prevents exponential runtime on dense graphs
- Hard cap: 5,000 cycles

**Complexity:** O((V + E) × C) where C = number of simple cycles. Bounded by timeout and hard cap.

---

### 2. Smurfing — Fan-in / Fan-out Detection

**What it detects:** Many small deposits aggregated into one account (fan-in) or one account dispersing to many (fan-out) — classic structuring to stay below reporting thresholds.

**Algorithm:**

1. Group transactions by target (fan-in) or source (fan-out)
2. Sort each group by timestamp — O(n log n)
3. Two-pointer sliding window (72-hour window) counts unique counterparties via a frequency dict
4. Trigger: 10+ unique counterparties in any window

**False positive control:**

- Accounts in the 98th percentile of **both** sending **and** receiving counts are excluded (high-volume merchants, payroll processors)
- Minimum 50 accounts required before exclusion activates

**Complexity:** O(n log n) per group (sort-dominated). The two-pointer scan is O(n).

---

### 3. Layered Shell Networks — Chain Detection

**What it detects:** Chains of 3+ hops through intermediate "shell" accounts with ≤3 total transactions, used to add distance between criminal source and destination.

**Algorithm:**

1. Classify every node: shell (≤3 tx) vs non-shell
2. Iterative DFS (stack-based, no recursion) from every non-shell source into the shell subgraph
3. Valid chain: non-shell source → shell intermediaries → non-shell destination
4. Depth limit: 6 hops max
5. Hard cap: 1,000 chains

**False positive control:**

- Both source and destination must be non-shell (prevents pure-shell chains)
- Visited-node tracking prevents revisits in a single path

**Complexity:** O(V × d^b) where d = average shell out-degree, b = max depth. Bounded by hard cap.

---

### 4. Bi-directional Flow — Round-trip Detection

**What it detects:** Account pairs where A→B and B→A both exist with similar total amounts — artificial round-tripping to create fake transaction volume.

**Algorithm:**

1. For every edge A→B, check if reverse edge B→A exists
2. Compute similarity: `1 - |amount_AB - amount_BA| / max(amount_AB, amount_BA)`
3. Flag if similarity ≥ 80% (configurable)
4. Deduplicate via sorted tuple keys

**Complexity:** O(E) — single pass over all edges.

---

### 5. Amount Anomaly Detection

**What it detects:** Transactions that deviate more than 3σ from an account's mean — sudden large deposits that break normal behaviour.

**Algorithm:**

1. Group transactions by account (sender and receiver separately)
2. For accounts with ≥5 transactions: compute mean and standard deviation
3. Flag if any transaction amount > μ + 3σ

**Complexity:** O(T) where T = total transactions (single aggregation pass).

---

### 6. Rapid Movement Detection

**What it detects:** Accounts that receive and forward funds within minutes — the hallmark of a pass-through mule.

**Algorithm:**

1. Per account: separate incoming and outgoing transactions, sort by timestamp
2. Two-pointer scan: for each incoming tx, find earliest outgoing tx that follows it
3. If dwell time ≤ 30 minutes → flag

**Complexity:** O(n log n) per account (sort-dominated). Two-pointer scan is O(n).

---

### 7. Amount Structuring Detection

**What it detects:** Multiple transactions deliberately kept just below the $10,000 CTR reporting threshold (31 USC § 5324).

**Algorithm:**

1. Define structuring band: $8,500 to $10,000 (15% margin below threshold)
2. Count sent transactions per account falling in the band
3. Flag if ≥3 transactions in band

**Complexity:** O(T) — single pass over all transactions.

---

### Overall Pipeline Complexity

**Total:** O(n log n) + O((V + E) × C) + O(V × d^b) + O(E) + O(T)

In practice, bounded by the cycle detection timeout (20s) and hard caps. Typical processing: **< 1s** for 1K rows, **< 5s** for 10K rows.

---

## Suspicion Score Methodology

Each account's suspicion score (0–100) is computed as the sum of weighted factors, capped at 100:

### Pattern Weights (Primary)

| Factor                  | Points | Description                                       |
| ----------------------- | ------ | ------------------------------------------------- |
| Cycle (length 3) member | **35** | Shortest cycles — hardest to explain legitimately |
| Cycle (length 4) member | **30** | Medium-length cycle                               |
| Cycle (length 5) member | **25** | Longer cycle, slightly lower confidence           |
| Fan-in hub/member       | **28** | Aggregator pattern (10+ senders in 72h)           |
| Fan-out hub/member      | **28** | Disperser pattern (10+ receivers in 72h)          |
| Shell chain member      | **22** | Pass-through layering via low-activity accounts   |
| Round-trip member       | **20** | Bi-directional symmetric flows                    |

### Enrichment Bonuses

| Factor                 | Points        | Trigger Condition                                    |
| ---------------------- | ------------- | ---------------------------------------------------- |
| Amount anomaly         | **+18**       | Transaction > 3σ from account mean                   |
| Rapid movement         | **+20**       | Receive-to-forward dwell time ≤ 30 minutes           |
| Amount structuring     | **+15**       | 3+ transactions in $8,500–$10,000 band               |
| High velocity          | **+15**       | Average > 5 transactions/day                         |
| Multi-ring bonus       | **+10/ring**  | Extra 10 points per additional ring beyond the first |
| Betweenness centrality | **up to +10** | Network hub importance (≤500 node graphs only)       |

### Formula

**Score = Σ(pattern weights) + Σ(enrichment bonuses), capped at 100.0**

Scores are sorted descending so the most suspicious accounts appear first.

### Risk Explanations

Every suspicious account receives a **natural language risk explanation** combining all applicable findings:

> _"Participates in a 3-node circular fund routing cycle. Receives and forwards funds within minutes (pass-through). Member of RING_001. Fastest pass-through: 4.0 min."_

### Confidence Scores

Each fraud ring receives a **confidence score** (0.0–1.0) based on pattern type, ring size, and cross-pattern corroboration:

| Pattern        | Base Confidence | Size Bonus (4+ members) | Merge Bonus |
| -------------- | --------------- | ----------------------- | ----------- |
| cycle_length_3 | 0.95            | +0.05                   | +0.05       |
| cycle_length_4 | 0.90            | +0.05                   | +0.05       |
| fan_in/fan_out | 0.80            | +0.05                   | +0.05       |
| round_trip     | 0.85            | +0.05                   | +0.05       |
| shell_chain    | 0.75            | +0.05                   | +0.05       |

---

## Installation & Setup

### Prerequisites

- Python >= 3.10
- Node.js >= 18
- npm or yarn

### Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Environment Variables (optional)

All defaults are set in `backend/app/config.py`. Override via environment variables:

| Variable                      | Default | Description                             |
| ----------------------------- | ------- | --------------------------------------- |
| `MAX_FILE_SIZE_MB`            | 20      | Max upload file size in MB              |
| `MAX_ROWS`                    | 10000   | Max transaction rows to process         |
| `FAN_THRESHOLD`               | 10      | Min unique counterparties for smurf     |
| `SMURF_WINDOW_HOURS`          | 72      | Sliding window duration in hours        |
| `CYCLE_TIMEOUT_SECONDS`       | 20      | Cycle detection timeout                 |
| `AMOUNT_ANOMALY_STDDEV`       | 3.0     | Std deviation threshold for anomalies   |
| `ROUND_TRIP_AMOUNT_TOLERANCE` | 0.2     | Max difference ratio for round-trip     |
| `RAPID_MOVEMENT_MINUTES`      | 30      | Dwell time threshold for rapid movement |
| `STRUCTURING_THRESHOLD`       | 10000   | CTR reporting threshold                 |
| `STRUCTURING_MARGIN`          | 0.15    | Band width below threshold (15%)        |
| `STRUCTURING_MIN_TX`          | 3       | Min transactions in band to flag        |
| `CORS_ORIGINS`                | \*      | Comma-separated allowed origins         |
| `VITE_API_URL`                | (empty) | Frontend API base URL for deployment    |

---

## Usage Instructions

1. **Open the web app** at [http://localhost:5173](http://localhost:5173)
2. **Upload a CSV file** via drag-and-drop or click-to-browse
   - Required columns: `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`
3. **View results** in three tabs:
   - **Network Graph** — Interactive force-directed visualization. Suspicious nodes are larger and color-coded by pattern type (red = cycle, purple = smurf, cyan = shell, yellow = multi-pattern). Click any node for a detail panel showing stats, score, and risk explanation.
   - **Fraud Rings** — Table showing each ring with Ring ID, Pattern Type, Member Count, Risk Score, Confidence Score, and Member Account IDs.
   - **Suspicious Accounts** — Table of flagged accounts sorted by suspicion score with detected patterns, ring assignment, and risk explanation.
4. **Download JSON report** via the button in the header — includes `suspicious_accounts`, `fraud_rings`, and `summary` with network statistics.
5. **Download sample CSV** to test with a pre-built dataset that triggers all detection patterns.

### API Endpoints

| Method | Path       | Description                                |
| ------ | ---------- | ------------------------------------------ |
| GET    | `/`        | Redirect to docs                           |
| GET    | `/health`  | Health check with version and config info  |
| POST   | `/analyze` | Upload CSV and run full forensics pipeline |

---

## JSON Output Format

```json
{
  "suspicious_accounts": [
    {
      "account_id": "ACC_00123",
      "suspicion_score": 87.5,
      "detected_patterns": ["cycle_length_3", "rapid_movement"],
      "ring_id": "RING_001",
      "risk_explanation": "Participates in a 3-node circular fund routing cycle. Receives and forwards funds within minutes (pass-through). Member of RING_001. Fastest pass-through: 4.0 min."
    }
  ],
  "fraud_rings": [
    {
      "ring_id": "RING_001",
      "member_accounts": ["ACC_00123", "ACC_00456", "ACC_00789"],
      "pattern_type": "cycle_length_3",
      "risk_score": 95.0,
      "confidence": 0.95
    }
  ],
  "summary": {
    "total_accounts_analyzed": 500,
    "suspicious_accounts_flagged": 15,
    "fraud_rings_detected": 4,
    "processing_time_seconds": 2.3,
    "network_statistics": {
      "total_nodes": 500,
      "total_edges": 450,
      "graph_density": 0.0036,
      "avg_degree": 1.8,
      "connected_components": 12,
      "avg_clustering": 0.08
    }
  },
  "graph": {
    "nodes": [
      {
        "id": "ACC_00123",
        "suspicious": true,
        "community_id": 0,
        "temporal_profile": {
          "hourly_distribution": [
            0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0
          ],
          "peak_hour": 10,
          "active_hours": 6
        }
      }
    ],
    "edges": ["..."]
  }
}
```

---

## Project Structure

```
financial-forensics-engine/
├── backend/
│   ├── requirements.txt              # Python dependencies
│   └── app/
│       ├── __init__.py
│       ├── config.py                  # Centralised config, all thresholds
│       ├── models.py                  # Pydantic v2 response schemas
│       ├── main.py                    # FastAPI app, /analyze endpoint, middleware
│       ├── parser.py                  # CSV validation (encoding, types, dedup)
│       ├── graph_builder.py           # NetworkX DiGraph with vectorised stats
│       ├── cycle_detector.py          # Johnson's algorithm + timeout + dedup
│       ├── smurf_detector.py          # Two-pointer sliding window fan detection
│       ├── shell_detector.py          # Iterative DFS shell chain finder
│       ├── bidirectional_detector.py  # Round-trip bi-directional flow detection
│       ├── anomaly_detector.py        # Statistical amount anomaly (3σ) detection
│       ├── rapid_movement_detector.py # Dwell-time pass-through detection
│       ├── structuring_detector.py    # Sub-$10K threshold structuring detection
│       ├── scoring.py                 # Multi-factor scoring + risk explanations
│       ├── formatter.py               # JSON builder, confidence, communities, temporal
│       └── utils.py                   # Ring merging (≥50% overlap) + ID assignment
├── frontend/
│   ├── package.json
│   ├── vite.config.js                 # Dev proxy + build config
│   ├── index.html
│   └── src/
│       ├── App.jsx                    # Root component with tabbed results
│       ├── App.css
│       ├── index.css                  # Global CSS variables (dark theme)
│       ├── main.jsx
│       └── components/
│           ├── FileUpload.jsx         # Drag-and-drop CSV upload + sample download
│           ├── GraphVisualization.jsx  # Force-directed graph with node detail panel
│           ├── SummaryStats.jsx       # Overview stat cards
│           ├── SummaryTable.jsx       # Fraud rings + suspicious accounts tables
│           └── DownloadButton.jsx     # JSON report download
├── Features.md                        # Detailed documentation of all 25 features
├── .gitignore
└── README.md
```

---

## Performance Analysis

| Metric                 | Target   | Achieved                                                                |
| ---------------------- | -------- | ----------------------------------------------------------------------- |
| Processing Time        | ≤ 30s    | < 1s for 1K rows, ~5s for 10K rows (cycle timeout bound at 20s)         |
| Precision              | ≥ 70%    | Merchant exclusion + shell endpoint rules + structuring band filtering  |
| Recall                 | ≥ 60%    | 7 detection patterns + 4 enrichment bonuses catch multi-layered schemes |
| False Positive Control | Required | Dual-threshold percentile exclusion, shell endpoint rules, min-sample   |

### Detection Coverage

| Threat Pattern             | Detection Method            | Confidence Level | Score Weight     |
| -------------------------- | --------------------------- | ---------------- | ---------------- |
| Circular routing (A→B→C→A) | Johnson's cycle enumeration | Very High        | 25–35            |
| Fan-in aggregation         | Two-pointer temporal window | High             | 28               |
| Fan-out dispersal          | Two-pointer temporal window | High             | 28               |
| Shell layering             | Iterative DFS chain search  | Medium-High      | 22               |
| Round-trip flows (A↔B)     | Bi-directional edge scan    | High             | 20               |
| Amount anomaly             | Statistical σ deviation     | Medium-High      | 18 (bonus)       |
| Rapid fund movement        | Dwell-time analysis         | High             | 20 (bonus)       |
| Amount structuring (<$10K) | Sub-threshold band scan     | High             | 15 (bonus)       |
| High-velocity mules        | Transaction rate analysis   | Medium           | 15 (bonus)       |
| Multi-pattern hubs         | Cross-ring membership count | Very High        | 10+ (bonus)      |
| Network centrality hubs    | Betweenness centrality      | Medium           | Up to 10 (bonus) |

---

## Known Limitations

1. **In-memory processing** — Entire CSV is loaded into memory. Files exceeding ~100K rows may cause memory pressure.
2. **Single-threaded detectors** — All 7 detectors run sequentially. Parallelising independent detectors could improve throughput by ~3×.
3. **Static thresholds** — Fan-in threshold (10), window (72h), structuring band ($8.5K–$10K) are configurable but not adaptive to dataset characteristics.
4. **No persistence** — Results are not stored server-side; re-uploading the same file re-runs the full analysis.
5. **Betweenness centrality** skipped for graphs with > 500 nodes due to O(V×E) complexity.
6. **Cycle detection** may time out (20s) on extremely dense graphs, returning partial results.
7. **Ring merging** uses greedy pairwise comparison; extremely fragmented overlaps could remain unmerged.
8. **Amount anomaly** requires ≥5 transactions per account for meaningful statistics — low-activity accounts are not evaluated.
9. **Average clustering coefficient** skipped for networks with >1,000 nodes to stay within processing budget.

---

## Team Members

| Name             | Role        |
| ---------------- | ----------- |
| Ayush Rai        | _Add roles_ |
| Harsh Upadhyay   | _Add roles_ |
| Prerna Negi      | _Add roles_ |
| Shubhanshu Singh | _Add roles_ |

---

_Built for the RIFT 2026 Hackathon — Money Muling Detection Challenge_

_#RIFTHackathon #MoneyMulingDetection #FinancialForensics #FinancialCrime_
