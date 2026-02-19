# Financial Forensics Engine

> A production-grade web application that detects money muling networks in financial transaction data through graph analysis and interactive visualization.

**Live Demo:** _[Add your deployed URL here]_

---

## Table of Contents
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Detection Algorithms](#detection-algorithms)
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

| Layer     | Technology                        | Purpose                                       |
| --------- | --------------------------------- | --------------------------------------------- |
| Backend   | **Python 3.13** / **FastAPI**     | REST API, CSV parsing, analysis orchestration  |
| Graph     | **NetworkX 3.x**                  | Directed graph construction, cycle detection   |
| Data      | **Pandas 3.x** / **NumPy**       | Vectorized transaction processing              |
| Validation| **Pydantic v2**                   | Request/response schema validation             |
| Frontend  | **React 18** / **Vite 5**         | Single-page application, drag-and-drop upload  |
| Viz       | **react-force-graph-2d**          | Force-directed interactive graph rendering     |
| HTTP      | **Axios**                         | API communication with timeout handling        |

---

## System Architecture

```
                       +------------------------+
               CSV     |   FastAPI Backend      |
  Browser  ----------> |   POST /analyze        |
  (React)              |                        |
                       +-------+--------+-------+
                               |        |
            +------------------+--------+------------------+
            |                  |        |                  |
            v                  v        v                  v
  +--------------+  +-------------+  +--------------+  +--------------+
  | parser.py    |  | graph_      |  | cycle_       |  | smurf_       |
  | CSV -> DF    |  | builder.py  |  | detector.py  |  | detector.py  |
  +--------------+  +-------------+  +--------------+  +--------------+
                                                        +--------------+
                                                        | shell_       |
                                                        | detector.py  |
                                                        +--------------+
            |                  |                  |
            v                  v                  v
       +----------------------------------------------------+
       |   utils.py  ->  scoring.py  -> formatter.py        |
       |   (merge)       (score)        (JSON out)           |
       +----------------------------------------------------+
```

### Pipeline Flow

1. **Parse** - CSV bytes are decoded (UTF-8 / latin-1 fallback), validated for required columns, amounts > 0, duplicate tx_id dedup, self-transaction removal, timestamp parsing with flexible format support.
2. **Build Graph** - A directed weighted graph is constructed with vectorized Pandas groupby operations. Each node holds aggregate stats (total_sent, total_received, net_flow, counterparty count). Each edge stores transaction count, total amount, and per-transaction drill-down.
3. **Detect Patterns** - Three detectors run in sequence:
   - **Cycle Detector** - Finds circular routing (len 3-5) using `nx.simple_cycles` with threading timeout
   - **Smurf Detector** - Finds fan-in/fan-out (10+ counterparties in 72h sliding window)
   - **Shell Detector** - Finds layered chains (3+ hops through low-activity intermediaries)
4. **Merge & ID** - Overlapping rings (>50% member overlap) are merged. Sequential IDs assigned: RING_001, RING_002, ...
5. **Score** - Multi-factor suspicion scoring: pattern weights + multi-ring bonus + velocity bonus + betweenness centrality bonus. Capped at 100.
6. **Format** - JSON response assembled matching the exact spec schema.

---

## Detection Algorithms

### 1. Circular Fund Routing (Cycle Detection)

**What it detects:** Money flowing in loops (A -> B -> C -> A) to obscure origin.

**Algorithm:** NetworkX `simple_cycles` (Johnson's algorithm) with:
- Length filter: 3 <= length <= 5
- Canonical deduplication: cycles are rotated to lexicographically smallest node first, so [A,B,C] and [B,C,A] are identified as the same ring
- Threading-based timeout (default 20s) to prevent exponential blowup on dense graphs
- Hard cap of 5000 cycles

**Complexity:** O(V + E) x (V + E) x C where C = number of simple cycles. Bounded by timeout and cap.

### 2. Smurfing (Fan-in / Fan-out)

**What it detects:** Structuring - many small deposits aggregated into one account (fan-in) or one account dispersing to many (fan-out).

**Algorithm:**
- Group transactions by target (fan-in) or source (fan-out)
- Two-pointer sliding window scans across time-sorted transactions
- Window size: 72 hours (configurable via `SMURF_WINDOW_HOURS`)
- Trigger threshold: 10+ unique counterparties in any window

**False positive control:**
- Accounts in the top 98th percentile of BOTH sending AND receiving counts are excluded (high-volume merchants, payroll processors)
- Minimum 50 accounts required before exclusion logic activates

**Complexity:** O(n log n) per group (sort) + O(n) two-pointer scan = O(n log n) overall per group.

### 3. Layered Shell Networks

**What it detects:** Chains of 3+ hops through intermediate "shell" accounts with <=3 total transactions, used to layer money between source and destination.

**Algorithm:**
- Classify all nodes: shell (<=3 total tx) vs non-shell
- Iterative DFS (stack-based) from every non-shell source into the shell subgraph
- Valid chain: non-shell source -> shell intermediaries -> non-shell destination
- Depth limit: 6 hops max (configurable)
- Hard cap: 1000 chains

**False positive control:**
- Both source and destination must be non-shell nodes (prevents pure-shell chains)
- Visited-node tracking prevents revisiting nodes in a single path

**Complexity:** O(V x d^b) where d = average out-degree of shell nodes, b = max chain depth. Bounded by cap.

---

## Suspicion Score Methodology

Each account's suspicion score (0-100) is computed as the sum of multiple weighted factors, capped at 100:

| Factor                    | Points     | Description                                             |
| ------------------------- | ---------- | ------------------------------------------------------- |
| Cycle (len 3) member      | **35**     | Highest-risk circular routing                           |
| Cycle (len 4) member      | **30**     | Medium-length cycle                                     |
| Cycle (len 5) member      | **25**     | Longer cycle, slightly lower confidence                 |
| Fan-in hub/member         | **28**     | Aggregator pattern                                      |
| Fan-out hub/member        | **28**     | Disperser pattern                                       |
| Shell chain member        | **22**     | Pass-through layering                                   |
| High velocity             | **+15**    | > 5 tx/day average across dataset timespan              |
| Multi-ring bonus          | **+10/ring** | Extra 10 points per additional ring beyond the first  |
| Betweenness centrality    | **up to +10** | Network hub importance (<=500 node graphs only)       |

**Score = Sum(pattern weights) + velocity bonus + multi-ring bonus + centrality bonus, capped at 100.0**

Scores are sorted descending in the output so the most suspicious accounts appear first.

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

| Variable                | Default | Description                          |
| ----------------------- | ------- | ------------------------------------ |
| `MAX_FILE_SIZE_MB`      | 20      | Max upload file size in MB           |
| `MAX_ROWS`              | 10000   | Max transaction rows to process      |
| `FAN_THRESHOLD`         | 10      | Min unique counterparties for smurf  |
| `SMURF_WINDOW_HOURS`    | 72      | Sliding window duration in hours     |
| `CYCLE_TIMEOUT_SECONDS` | 20      | Cycle detection timeout              |
| `CORS_ORIGINS`          | *       | Comma-separated allowed origins      |
| `VITE_API_URL`          | (empty) | Frontend API base URL for deployment |

---

## Usage Instructions

1. **Open the web app** at the frontend URL
2. **Upload a CSV file** via drag-and-drop or click-to-browse (required columns: `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`)
3. **View results** in three tabs:
   - **Network Graph** - Interactive force-directed visualization. Suspicious nodes are larger and color-coded by pattern type. Click any node for details.
   - **Fraud Rings** - Table showing each detected ring with Ring ID, Pattern Type, Member Count, Risk Score, and Member Account IDs.
   - **Suspicious Accounts** - Table of flagged accounts sorted by suspicion score with detected patterns and ring assignment.
4. **Download JSON report** via the button in the header. The file includes `suspicious_accounts`, `fraud_rings`, and `summary` in the exact spec format.
5. **Download sample CSV** to test with a pre-built dataset containing all three pattern types.

---

## JSON Output Format

```json
{
  "suspicious_accounts": [
    {
      "account_id": "ACC_00123",
      "suspicion_score": 87.5,
      "detected_patterns": ["cycle_length_3", "high_velocity"],
      "ring_id": "RING_001"
    }
  ],
  "fraud_rings": [
    {
      "ring_id": "RING_001",
      "member_accounts": ["ACC_00123", "ACC_00456", "ACC_00789"],
      "pattern_type": "cycle_length_3",
      "risk_score": 95.0
    }
  ],
  "summary": {
    "total_accounts_analyzed": 500,
    "suspicious_accounts_flagged": 15,
    "fraud_rings_detected": 4,
    "processing_time_seconds": 2.3
  }
}
```

---

## Project Structure

```
financial-forensics-engine/
|-- backend/
|   |-- requirements.txt        # Python dependencies
|   +-- app/
|       |-- __init__.py
|       |-- config.py            # Centralised env-var config, all thresholds
|       |-- models.py            # Pydantic v2 response schemas
|       |-- main.py              # FastAPI app, /analyze endpoint, middleware
|       |-- parser.py            # CSV validation (encoding, types, dedup)
|       |-- graph_builder.py     # NetworkX DiGraph with vectorised stats
|       |-- cycle_detector.py    # Johnson's algorithm + timeout + dedup
|       |-- smurf_detector.py    # Two-pointer sliding window fan detection
|       |-- shell_detector.py    # Iterative DFS shell chain finder
|       |-- scoring.py           # Multi-factor suspicion scoring engine
|       |-- formatter.py         # JSON response builder (spec-compliant)
|       +-- utils.py             # Ring merging (>=50% overlap) + ID assignment
|-- frontend/
|   |-- package.json
|   |-- vite.config.js           # Dev proxy + build config
|   |-- index.html
|   +-- src/
|       |-- App.jsx              # Root component with tabbed results
|       |-- App.css
|       |-- index.css            # Global CSS variables (dark theme)
|       |-- main.jsx
|       +-- components/
|           |-- FileUpload.jsx       # Drag-and-drop CSV upload + sample download
|           |-- GraphVisualization.jsx # Force-directed graph with node detail panel
|           |-- SummaryStats.jsx     # Overview stat cards
|           |-- SummaryTable.jsx     # Fraud rings + suspicious accounts tables
|           +-- DownloadButton.jsx   # JSON report download
|-- .gitignore
+-- README.md
```

---

## Performance Analysis

| Metric                | Target     | Achieved                                                            |
| --------------------- | ---------- | ------------------------------------------------------------------- |
| Processing Time       | <= 30s     | < 1s for 100-1K rows, ~5s for 10K rows (cycle timeout bound at 20s)|
| Precision             | >= 70%     | High-volume merchant exclusion + shell source/dest filter           |
| Recall                | >= 60%     | All three pattern families detected, multi-ring bonus catches hubs  |
| False Positive Control| Required   | Dual-threshold percentile exclusion, shell endpoint rules           |

---

## Known Limitations

1. **In-memory processing** - Entire CSV is loaded into memory. Extremely large files (>100K rows) may cause memory pressure.
2. **Single-threaded detectors** - Detectors run sequentially. Parallelising cycle + smurf + shell detection could improve throughput.
3. **Static thresholds** - Fan-in/out threshold (10), window (72h), shell tx limit (3) are configurable but not adaptive to dataset characteristics.
4. **No persistence** - Results are not stored; re-uploading the same file re-runs the full analysis.
5. **Betweenness centrality** skipped for graphs with > 500 nodes due to O(V*E) complexity.
6. **Cycle detection** may time out on extremely dense graphs, returning partial results.
7. **Ring merging** uses greedy pairwise comparison; extremely fragmented rings could remain unmerged.

---

## Team Members

| Name          | Role                  |
| ------------- | --------------------- |
| Ayush Rai | _Add roles_           |
| Harsh Upadhyay | _Add roles_           |
| Prerna Negi | _Add roles_           |
| Shubhanshu Singh | _Add roles_           |


---

_Built for the RIFT Hackathon - #RIFTHackathon #MoneyMulingDetection #FinancialCrime_
