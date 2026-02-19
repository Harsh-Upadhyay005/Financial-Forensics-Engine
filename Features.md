# Features — Financial Forensics Engine

A complete breakdown of every feature in the system, how it works internally, and why it matters for detecting money muling.

---

## Table of Contents

1. [CSV File Upload & Validation](#1-csv-file-upload--validation)
2. [Transaction Graph Construction](#2-transaction-graph-construction)
3. [Circular Fund Routing Detection (Cycles)](#3-circular-fund-routing-detection-cycles)
4. [Smurfing Detection (Fan-in / Fan-out)](#4-smurfing-detection-fan-in--fan-out)
5. [Layered Shell Network Detection](#5-layered-shell-network-detection)
6. [False Positive Control](#6-false-positive-control)
7. [Ring Merging & ID Assignment](#7-ring-merging--id-assignment)
8. [Multi-Factor Suspicion Scoring](#8-multi-factor-suspicion-scoring)
9. [Interactive Graph Visualization](#9-interactive-graph-visualization)
10. [Fraud Ring Summary Table](#10-fraud-ring-summary-table)
11. [Suspicious Accounts Table](#11-suspicious-accounts-table)
12. [Downloadable JSON Report](#12-downloadable-json-report)
13. [Health Check Endpoint](#13-health-check-endpoint)
14. [Request-ID Tracing Middleware](#14-request-id-tracing-middleware)
15. [Centralised Configuration](#15-centralised-configuration)
16. [Sample CSV Download](#16-sample-csv-download)

---

## 1. CSV File Upload & Validation

**File:** `backend/app/parser.py`

### What It Does

Accepts a raw CSV file upload (up to 20 MB), decodes it, validates every row, and produces a clean Pandas DataFrame ready for analysis.

### How It Works

1. **Encoding Detection** — Tries UTF-8 first; falls back to latin-1 if decoding fails. This handles CSVs exported from Excel or legacy systems that use non-UTF encodings.

2. **Column Validation** — Checks that all 5 required columns exist: `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`. Column names are normalised to lowercase with underscores. If any are missing, a 422 error is returned listing exactly which columns are absent.

3. **Empty Field Removal** — Rows where any required field is blank are dropped with a warning.

4. **Amount Parsing** — The `amount` column is cast to float. Non-numeric values and values ≤ 0 are dropped with warnings.

5. **Timestamp Parsing** — Tries three formats in order: `YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS` (ISO), and `YYYY-MM-DD HH:MM`. If none work for ≥90% of rows, falls back to Pandas' flexible inference. Unparseable rows are dropped.

6. **Self-Transaction Removal** — Transactions where `sender_id == receiver_id` are removed because they don't represent real money flow and would create self-loops in the graph.

7. **Duplicate Transaction ID Dedup** — If multiple rows share the same `transaction_id`, only the first occurrence is kept.

8. **Row Limit Enforcement** — If more than 10,000 valid rows remain, the dataset is truncated (configurable via `MAX_ROWS` env var).

9. **Parse Stats** — Returns a stats dict alongside the DataFrame containing `total_rows`, `valid_rows`, `dropped_rows`, `duplicate_tx_ids`, `self_transactions`, `negative_amounts`, and a `warnings` list. These stats are included in the API response so the user knows exactly what was cleaned.

### Why It Matters

Garbage in = garbage out. Without rigorous validation, invalid rows would corrupt the graph (e.g., self-loops creating false cycles, negative amounts skewing scoring). The detailed warnings make it transparent what was cleaned so users can fix their source data.

---

## 2. Transaction Graph Construction

**File:** `backend/app/graph_builder.py`

### What It Does

Builds a directed weighted graph (NetworkX DiGraph) where accounts are nodes and transactions are edges.

### How It Works

1. **Vectorised Node Statistics** — Uses Pandas `groupby` operations (not per-row loops) to compute each account's:
   - `total_sent` / `total_received` — aggregate money flow
   - `net_flow` — `total_received - total_sent` (positive = net receiver)
   - `sent_count` / `received_count` / `tx_count` — transaction counts
   - `avg_sent` / `avg_received` — average transaction sizes
   - `unique_counterparties` — how many distinct accounts this one transacts with
   - `first_tx` / `last_tx` — earliest and latest activity timestamps

2. **Edge Construction** — For each unique `(sender, receiver)` pair, an edge is created with:
   - `total_amount` — sum of all transactions on this edge
   - `avg_amount` — mean transaction size
   - `tx_count` — number of transactions
   - `first_tx` / `last_tx` — time range
   - `transactions` — full per-transaction drill-down list (transaction_id, amount, timestamp)

### Why It Matters

The graph is the foundation for all three detection algorithms. Rich node/edge metadata enables the frontend's interactive detail panel — clicking a node shows all its stats without another API call. Vectorised Pandas operations keep construction fast even for 10K-row datasets.

---

## 3. Circular Fund Routing Detection (Cycles)

**File:** `backend/app/cycle_detector.py`

### What It Does

Detects money flowing in loops: A → B → C → A. These cycles are a primary money laundering technique where funds are circulated through multiple accounts to obscure their criminal origin.

### How It Works

1. **Algorithm** — Uses NetworkX's `simple_cycles()` which implements Johnson's algorithm for finding all elementary circuits in a directed graph.

2. **Length Filter** — Only cycles of length 3 to 5 are kept. Length-2 cycles (A → B → A) are just normal back-and-forth payments. Cycles longer than 5 are rare in real muling networks and expensive to enumerate.

3. **Canonical Deduplication** — A cycle [A, B, C] and [B, C, A] are the same ring. The detector rotates each cycle so the lexicographically smallest node is first, then uses this canonical form as a set key. This prevents duplicate ring reporting.

4. **Threading Timeout** — A background timer (default 20 seconds) sets a stop event. If cycle enumeration exceeds this time (possible on dense graphs), the detector stops gracefully and returns whatever cycles it found so far, logging a warning.

5. **Hard Cap** — Maximum 5,000 cycles stored to prevent memory exhaustion on pathological graphs.

### Output

Each detected cycle becomes a ring dict:

```json
{
  "members": ["ACC_A", "ACC_B", "ACC_C"],
  "pattern": "cycle_length_3",
  "cycle_length": 3
}
```

### Why It Matters

Circular fund routing is the single highest-confidence indicator of money muling. If money flows A → B → C → A with no legitimate business reason, it's almost certainly layering. This is why cycle_length_3 carries the highest risk score (95) and suspicion weight (35 points).

---

## 4. Smurfing Detection (Fan-in / Fan-out)

**File:** `backend/app/smurf_detector.py`

### What It Does

Detects structuring patterns where many small deposits are aggregated into one account (fan-in) or one account quickly disperses funds to many recipients (fan-out). These patterns are used to stay below regulatory reporting thresholds (e.g., the $10,000 CTR limit).

### How It Works

#### Fan-in Detection

1. Group all transactions by `receiver_id` (the potential aggregator hub)
2. Sort each group by timestamp
3. Run a **two-pointer sliding window** across the sorted transactions:
   - Right pointer advances, adding each sender to a counter dict
   - Left pointer advances when the window exceeds 72 hours
   - If the number of unique senders in any window ≥ 10, the hub is flagged
4. All senders within the triggering window + the hub become ring members

#### Fan-out Detection

Same algorithm but reversed: group by `sender_id`, track unique `receiver_id`s.

#### Two-Pointer Sliding Window (Performance)

The sliding window uses an O(n) two-pointer approach instead of the naive O(n²) nested loop:

- A `dict` maps each counterparty to its count within the current window
- When a transaction slides out of the left side, its counterparty's count is decremented; if it reaches 0, the counterparty is removed from the dict
- `len(dict)` gives the unique counterparty count in O(1)
- Total: O(n) per group after the O(n log n) sort

### Output

```json
{
  "members": ["SENDER_01", "SENDER_02", ..., "HUB"],
  "pattern": "fan_in",
  "hub": "HUB",
  "hub_type": "aggregator"
}
```

### Why It Matters

Smurfing is the most common money laundering technique globally. By using temporal analysis (72-hour windows), the detector catches accounts that receive many small deposits in a short burst — the hallmark of a mule aggregator collecting from multiple sources before moving funds onward.

---

## 5. Layered Shell Network Detection

**File:** `backend/app/shell_detector.py`

### What It Does

Detects chains of 3+ hops where intermediate accounts ("shells") have very low transaction counts (≤3 total). These shell accounts exist purely to add layers between the criminal source and the final destination.

### How It Works

1. **Node Classification** — Every account with ≤3 total transactions is classified as a "shell node". All others are "non-shell".

2. **Iterative DFS** — For each non-shell node (potential money source), an iterative depth-first search (stack-based, not recursive) explores outgoing edges into the shell subgraph:
   - The stack stores `(current_path, visited_set)` tuples
   - At each step, the algorithm checks all successors of the current node
   - If a successor is a non-shell node AND the path has ≥3 hops AND all intermediaries are shells → **valid chain found**
   - If a successor is a shell node and depth hasn't exceeded the limit (6 hops) → extend the path and push onto the stack

3. **Path Deduplication** — Each discovered path is stored as a tuple key to prevent duplicates.

4. **Hard Cap** — Maximum 1,000 chains to prevent excessive output.

### Key Constraint: Source and Destination Must Be Non-Shell

This is critical for false positive control. A chain like `SHELL_1 → SHELL_2 → SHELL_3` with no real endpoints is meaningless — it's just inactive accounts linked together. Real shell layering starts from a funded source and ends at a funded destination.

### Output

```json
{
  "members": ["SOURCE", "SHELL_1", "SHELL_2", "DESTINATION"],
  "pattern": "shell_chain",
  "chain_length": 3,
  "shell_intermediaries": ["SHELL_1", "SHELL_2"]
}
```

### Why It Matters

Shell companies and shell accounts are a classic money laundering structure. By requiring the intermediate accounts to have minimal activity (≤3 tx), the detector focuses on accounts that exist solely as pass-throughs — a strong signal of intentional layering.

---

## 6. False Positive Control

**Files:** `backend/app/smurf_detector.py`, `backend/app/shell_detector.py`, `backend/app/config.py`

### What It Does

Prevents legitimate high-volume accounts (merchants, payroll processors, utility companies) from being falsely flagged as money mule hubs.

### How It Works

#### High-Volume Merchant Exclusion (Smurfing)

1. Compute send counts and receive counts for all accounts
2. Calculate the 98th percentile threshold for each direction
3. **Only exclude accounts that are in the top 2% of BOTH sending AND receiving**
4. Minimum 50 accounts in the dataset before exclusion activates

**Why BOTH directions?** A legitimate merchant (e.g., Amazon) receives from thousands of customers AND pays thousands of suppliers. A mule aggregator receives from many but sends to few. By requiring high volume in both directions, genuine businesses are excluded while mule hubs (which are one-directional) remain flagged.

#### Shell Chain Endpoint Rules

- Source and destination of shell chains must have >3 transactions (non-shell)
- Pure shell-to-shell paths are excluded
- Visited-node tracking prevents loops within a single chain

### Why It Matters

The spec explicitly warns: _"Your solution will be tested against hidden datasets containing legitimate account traps designed to catch naive algorithms."_ Without this control, any high-volume hub (payroll, marketplace) would be flagged as a fan-in/fan-out pattern, destroying precision.

---

## 7. Ring Merging & ID Assignment

**File:** `backend/app/utils.py`

### What It Does

Combines rings from all three detectors, merges overlapping rings into unified rings, and assigns sequential IDs (RING_001, RING_002, ...).

### How It Works

1. **Combine** — All ring lists are concatenated in priority order: cycles first (highest confidence), then smurfing rings, then shell chains.

2. **Overlap Detection** — For each pair of rings, compute member overlap:
   - `overlap_ratio = |intersection| / |smaller ring|`
   - If ratio ≥ 50%, the two rings are considered the same underlying fraud network

3. **Greedy Merge** — Rings are merged greedily: for each unmerged ring, scan all subsequent rings and absorb any that overlap sufficiently. The merged ring keeps the highest-priority pattern name.

4. **ID Assignment** — Sequential IDs are stamped: RING_001, RING_002, etc.

### Why It Matters

Without merging, the same group of accounts might appear as both a cycle ring and a fan-in ring, confusing the user with duplicate detections. Merging produces a cleaner output where each fraud network is reported once with its most significant pattern.

---

## 8. Multi-Factor Suspicion Scoring

**File:** `backend/app/scoring.py`

### What It Does

Assigns each flagged account a suspicion score from 0 to 100 based on multiple factors. Higher scores indicate stronger evidence of money muling involvement.

### How It Works

The score is the sum of five components, capped at 100:

#### Component 1: Pattern Contribution (22–35 points per pattern)

Each ring membership adds points based on the pattern type:

| Pattern        | Points | Rationale                                                |
| -------------- | ------ | -------------------------------------------------------- |
| cycle_length_3 | 35     | Shortest cycles are hardest to explain legitimately      |
| cycle_length_4 | 30     | Still strong evidence                                    |
| cycle_length_5 | 25     | Longer cycles have more possible innocent explanations   |
| fan_in         | 28     | Aggregation is a core muling step                        |
| fan_out        | 28     | Dispersal is the other core muling step                  |
| shell_chain    | 22     | Lower weight because shell detection has more edge cases |

If an account is in multiple rings, it gets points from each one.

#### Component 2: Multi-Ring Bonus (+10 per extra ring)

Accounts belonging to more than one ring get +10 points for each additional ring beyond the first. An account in 3 rings gets +20 bonus. This rewards the scoring of hub accounts that participate in multiple fraud networks.

#### Component 3: High Velocity Bonus (+15)

Accounts whose average transactions-per-day exceeds 5 (across the full dataset timespan) get a +15 bonus. High transaction velocity is a known red flag — mules move money quickly before accounts are frozen.

#### Component 4: Betweenness Centrality Bonus (up to +10)

For graphs with ≤500 nodes, NetworkX computes betweenness centrality — a measure of how often a node sits on the shortest path between other nodes. High centrality means the account is a critical hub in the money flow network. The bonus scales linearly from 0 to 10 based on the account's centrality relative to the maximum in the graph.

Skipped for larger graphs to stay within the 30-second processing budget (centrality is O(V×E)).

#### Component 5: Cap at 100

The final score is `min(sum, 100.0)`, rounded to 1 decimal place.

### Output

```python
{
  "ACC_A": {
    "score": 45.0,
    "patterns": ["cycle_length_3", "high_velocity"],
    "ring_ids": ["RING_001"]
  }
}
```

### Why It Matters

A single number (0–100) makes it easy for investigators to prioritise which accounts to examine first. The multi-factor approach ensures that accounts involved in multiple patterns or with unusual velocity get appropriately elevated scores, while single-pattern-only accounts get moderate scores.

---

## 9. Interactive Graph Visualization

**File:** `frontend/src/components/GraphVisualization.jsx`

### What It Does

Renders a force-directed network graph where accounts are nodes and transactions are directed edges. Suspicious nodes are visually highlighted with different colors and sizes.

### How It Works

1. **Force Layout** — Uses `react-force-graph-2d` which simulates physical forces (charge repulsion + link attraction) to automatically arrange nodes in a readable layout.

2. **Color Coding:**
   - Green (#4ade80) — Safe/normal account
   - Red (#ff4d6d) — Cycle pattern detected
   - Purple (#c77dff) — Fan-in or fan-out pattern
   - Cyan (#00b4d8) — Shell chain pattern
   - Yellow (#ffd166) — Multi-pattern or unclassified suspicious

3. **Size Scaling** — Suspicious nodes are larger, scaled by their suspicion score. A node with score 80 is visibly larger than one with score 30. Safe nodes all have the same small size.

4. **Glow Effect** — Suspicious nodes have a CSS shadow glow in their pattern color, making them pop out against the dark background.

5. **Labels** — Account labels appear when zoomed in (globalScale > 1.5). Suspicious nodes always show labels regardless of zoom level.

6. **Directed Arrows** — Edges have arrow heads showing money flow direction. Animated particles flow along edges to reinforce directionality.

7. **Click Interaction** — Clicking a node:
   - Centers and zooms the camera to that node
   - Opens a detail panel showing: Total Transactions, Total Sent, Total Received, Suspicion Score, Ring ID, and Detected Patterns

8. **Hover** — Hovering a node highlights it with a white border and cursor change.

9. **Legend** — A legend bar shows what each color means and the node count per category.

### Why It Matters

Humans are excellent at recognising visual patterns. A graph view immediately reveals clusters, loops, star topologies (fan-in/out), and chains that would be invisible in a spreadsheet. Investigators can visually trace fund flows across the network.

---

## 10. Fraud Ring Summary Table

**File:** `frontend/src/components/SummaryTable.jsx` (type="rings")

### What It Does

Displays a searchable, sortable table listing every detected fraud ring with its metadata.

### Columns

| Column             | Description                                      |
| ------------------ | ------------------------------------------------ |
| Ring ID            | Sequential identifier (RING_001, RING_002, ...)  |
| Pattern Type       | Color-coded badge showing the detection pattern  |
| Members            | Count of accounts in the ring                    |
| Risk Score         | Visual progress bar (0–100) with color coding    |
| Member Account IDs | Comma-separated list, expandable for large rings |

### How It Works

- **Search** — Filters by ring ID, pattern type, or account ID in real time
- **Expand/Collapse** — Rings with >3 members show a preview of the first 3 accounts with a "+N more" button
- **Risk Score Bar** — Red (≥70), Yellow (≥40), Green (<40) colour coding
- **Pattern Badges** — Each pattern type gets a distinct coloured badge for quick scanning

### Why It Matters

The spec requires: _"Display a table in the web UI showing each detected ring with Ring ID, Pattern Type, Member Count, Risk Score, and Member Account IDs."_ This table fulfils that requirement exactly and adds searchability.

---

## 11. Suspicious Accounts Table

**File:** `frontend/src/components/SummaryTable.jsx` (type="accounts")

### What It Does

Lists every flagged account sorted by suspicion score (highest first), showing detected patterns and ring assignment.

### Columns

| Column            | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| #                 | Rank by suspicion score                                             |
| Account ID        | The flagged account identifier                                      |
| Suspicion Score   | Visual score bar with colour coding                                 |
| Detected Patterns | Badge chips for each pattern (cycle, fan-in, shell, velocity, etc.) |
| Ring ID           | Primary ring this account belongs to                                |

### How It Works

- Sorted descending by `suspicion_score` (spec requirement)
- Searchable by account ID, pattern name, or ring ID
- Pattern badges match the colour scheme used in the graph visualization

### Why It Matters

Investigators need a rank-ordered list of the most suspicious accounts to prioritise their case work. The detected patterns column tells them at a glance what type of activity was flagged.

---

## 12. Downloadable JSON Report

**File:** `frontend/src/components/DownloadButton.jsx`

### What It Does

Generates and downloads a JSON file containing the analysis results in the exact format required by the spec.

### How It Works

1. Strips the `graph` data from the response (not required in the download file)
2. Keeps `suspicious_accounts`, `fraud_rings`, and `summary`
3. Creates a Blob with `application/json` MIME type
4. Triggers a browser download with filename `forensics_report_YYYY-MM-DD.json`

### JSON Structure

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
      "member_accounts": ["ACC_00123", "ACC_00456"],
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

### Why It Matters

The spec states: _"Outputs will be tested line-by-line against expected test case results."_ The download produces a file in the exact schema with all mandatory fields. Scores are sorted descending, patterns are sorted alphabetically — deterministic output for automated testing.

---

## 13. Health Check Endpoint

**File:** `backend/app/main.py`

### What It Does

`GET /health` returns server status, version, and configuration info.

### Response

```json
{
  "status": "healthy",
  "version": "1.1.0",
  "max_file_size_mb": 20
}
```

### Why It Matters

Required for deployment platforms (Render, Railway, etc.) that need a health check URL to verify the service is alive. Also useful for monitoring and debugging.

---

## 14. Request-ID Tracing Middleware

**File:** `backend/app/main.py`

### What It Does

Injects an `X-Request-ID` header into every HTTP response. If the client sends an `X-Request-ID` header, it's echoed back; otherwise a UUID is generated.

### How It Works

```python
@app.middleware("http")
async def add_request_id(request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response
```

### Why It Matters

In production, when an API call fails, having a unique request ID makes it possible to trace the exact request through server logs. This is a standard production practice for debugging and audit trails.

---

## 15. Centralised Configuration

**File:** `backend/app/config.py`

### What It Does

All tunable thresholds are defined in one file with environment variable overrides. No magic numbers scattered across modules.

### Configuration Parameters

| Parameter                  | Default | Description                              |
| -------------------------- | ------- | ---------------------------------------- |
| `MAX_FILE_SIZE_MB`         | 20      | Maximum upload size                      |
| `MAX_ROWS`                 | 10,000  | Row limit before truncation              |
| `CYCLE_MIN_LEN`            | 3       | Minimum cycle length to detect           |
| `CYCLE_MAX_LEN`            | 5       | Maximum cycle length to detect           |
| `MAX_CYCLES`               | 5,000   | Hard cap on cycles stored                |
| `CYCLE_TIMEOUT_SECONDS`    | 20      | Timeout for cycle enumeration            |
| `FAN_THRESHOLD`            | 10      | Min unique counterparties for fan-in/out |
| `SMURF_WINDOW_HOURS`       | 72      | Sliding window duration                  |
| `HIGH_VOL_PERCENTILE`      | 0.98    | Percentile for merchant exclusion        |
| `SHELL_MAX_TX`             | 3       | Max tx count for a node to be "shell"    |
| `SHELL_MIN_CHAIN`          | 3       | Min hops for a valid shell chain         |
| `SHELL_MAX_CHAIN`          | 6       | Max hops depth limit                     |
| `SCORE_CYCLE_3`            | 35      | Suspicion weight for 3-node cycles       |
| `SCORE_FAN_IN`             | 28      | Suspicion weight for fan-in              |
| `SCORE_HIGH_VELOCITY`      | 15      | Bonus for high-velocity accounts         |
| `SCORE_MULTI_RING_BONUS`   | 10      | Bonus per extra ring membership          |
| `HIGH_VELOCITY_TX_PER_DAY` | 5       | Threshold for velocity bonus             |
| `CORS_ORIGINS`             | \*      | Allowed CORS origins                     |

### Why It Matters

Centralised config means an investigator can tune detection sensitivity by changing one env var (e.g., lowering `FAN_THRESHOLD` to 5 for stricter detection) without touching any code. This is essential for adapting to different datasets and jurisdictions.

---

## 16. Sample CSV Download

**File:** `frontend/src/components/FileUpload.jsx`

### What It Does

A "Download Sample CSV" button in the upload area generates and downloads a pre-built CSV containing the correct column format and example data that triggers all three detection patterns.

### Sample Data Includes

- A 3-node cycle (ACC_A → ACC_B → ACC_C → ACC_A)
- A fan-in hub (11 accounts sending to ACC_E)
- Normal transactions for demonstration

### Why It Matters

Users don't have to guess the correct CSV format. They can download the sample, open it in Excel to see the structure, and immediately test the application with data that produces visible results.

---

## Summary of Detection Coverage

| Threat Pattern             | Detection Method            | Confidence Level | Score Weight     |
| -------------------------- | --------------------------- | ---------------- | ---------------- |
| Circular routing (A→B→C→A) | Johnson's cycle enumeration | Very High        | 25–35            |
| Fan-in aggregation         | Two-pointer temporal window | High             | 28               |
| Fan-out dispersal          | Two-pointer temporal window | High             | 28               |
| Shell layering             | Iterative DFS chain search  | Medium-High      | 22               |
| High-velocity mules        | Transaction rate analysis   | Medium           | 15 (bonus)       |
| Multi-pattern hubs         | Cross-ring membership count | Very High        | 10+ (bonus)      |
| Network centrality hubs    | Betweenness centrality      | Medium           | Up to 10 (bonus) |

---

## Performance Characteristics

| Metric                     | Value                           |
| -------------------------- | ------------------------------- |
| Max supported dataset      | 10,000 transactions             |
| Processing time (1K rows)  | < 1 second                      |
| Processing time (10K rows) | < 5 seconds                     |
| Cycle detection timeout    | 20 seconds (configurable)       |
| Memory usage               | In-memory (Pandas + NetworkX)   |
| API response format        | JSON with exact spec compliance |
