# Financial Forensics Engine — Project Overview

---

## 1. Problem Statement

### What is Money Muling?

Money muling is a form of money laundering where criminals recruit individuals — knowingly or unknowingly — to receive illegally obtained funds into their personal bank accounts and forward them onward. The mule keeps a small commission; the criminal gets clean, untraceable money.

### The Scale of the Problem

- The United Nations estimates **2–5% of global GDP** ($800 billion – $2 trillion) is laundered annually.
- Money mules are the operational backbone of this infrastructure.
- Europol's 2024 report identified **over 10,000 money mule transactions** in a single coordinated operation.
- Victims lose money to fraud; mules face criminal prosecution, frozen accounts, and destroyed credit.

### Why Current Detection Fails

| Challenge              | Why It's Hard                                                              |
| ---------------------- | -------------------------------------------------------------------------- |
| **Volume**             | Banks process millions of transactions daily — manual review is impossible |
| **Camouflage**         | Individual mule transactions look like normal banking activity             |
| **Layering**           | Money passes through 3–6 shell accounts before reaching the destination    |
| **Structuring**        | Amounts are kept below $10,000 to dodge automatic reporting thresholds     |
| **Speed**              | Funds move in minutes — faster than any human investigation                |
| **Network complexity** | Dozens of accounts form graph structures invisible to spreadsheet analysis |

### The Gap

Traditional rule-based systems (e.g., "flag any transaction over $10,000") are easily bypassed by structuring. Machine learning models require massive labelled datasets that banks rarely have. Neither approach sees the **network structure** — the relationships between accounts that reveal coordinated criminal activity.

---

## 2. Solution

### Financial Forensics Engine

A web application that takes raw transaction data (CSV), builds a **directed graph** of the money flow network, and applies **7 detection algorithms + 4 enrichment layers** to automatically identify fraud rings, rank suspicious accounts, and generate investigator-ready reports.

### How It Works (Simple Version)

1. **Upload** a CSV file containing transactions (sender, receiver, amount, timestamp)
2. The engine builds a network graph where accounts are nodes and transactions are edges
3. Seven detection algorithms scan the graph for muling patterns
4. Every suspicious account gets a 0–100 risk score and a plain-English explanation
5. Results are displayed as an interactive network map, sortable tables, and a downloadable JSON report

### What Makes It Different

| Traditional Approach            | Our Approach                                        |
| ------------------------------- | --------------------------------------------------- |
| Rule-based (static thresholds)  | Graph-based (structural pattern recognition)        |
| Single-transaction analysis     | Network-wide analysis across all accounts           |
| Binary flag (suspicious / not)  | 0–100 risk score with natural language explanation  |
| Requires labelled training data | Unsupervised — works on any transaction dataset     |
| Text reports                    | Interactive graph visualization + downloadable JSON |

---

## 3. Tech Stack

| Layer          | Technology            | Why We Chose It                                                                       |
| -------------- | --------------------- | ------------------------------------------------------------------------------------- |
| **Backend**    | Python 3.13 / FastAPI | Async REST API, automatic OpenAPI docs, type safety                                   |
| **Graph**      | NetworkX 3.x          | Mature graph library with cycle detection, community detection, centrality algorithms |
| **Data**       | Pandas 3.x / NumPy    | Vectorized operations — 10K transactions processed in <1s                             |
| **Validation** | Pydantic v2           | Schema enforcement on API input/output                                                |
| **Frontend**   | React 18 / Vite 5     | Component-based UI with hot reload, fast builds                                       |
| **Viz**        | react-force-graph-2d  | GPU-accelerated force-directed graph with zoom/pan/click                              |
| **HTTP**       | Axios                 | Promise-based HTTP with 60s timeout for large files                                   |

### Why This Stack?

- **No database needed** — Everything runs in-memory for hackathon simplicity. Upload → Analyze → Download.
- **No ML training required** — All 7 detectors are unsupervised algorithms that work on any transaction dataset without labelled data.
- **Single-command setup** — `pip install` + `npm install` → running in under 2 minutes.
- **Deployable anywhere** — Backend is a single FastAPI process; frontend is static files.

---

## 4. Methodology

### 7-Stage Processing Pipeline

```
CSV Upload → Parse & Validate → Build Graph → Detect Patterns → Enrich → Score → Format & Return
```

| Stage | Module                    | What Happens                                                                         |
| ----- | ------------------------- | ------------------------------------------------------------------------------------ |
| 1     | `parser.py`               | Decode CSV, validate columns, clean amounts/timestamps, remove self-transfers, dedup |
| 2     | `graph_builder.py`        | Build directed weighted graph with per-node and per-edge statistics                  |
| 3     | Core detectors (×4)       | Cycle detection, fan-in/fan-out, shell chains, round-trip detection                  |
| 4     | Enrichment detectors (×3) | Amount anomaly (3σ), rapid movement (dwell time), structuring (sub-$10K)             |
| 5     | `utils.py`                | Merge overlapping rings (≥50% member overlap), assign RING_001, RING_002, ...        |
| 6     | `scoring.py`              | Compute 0–100 suspicion score + generate risk explanation strings                    |
| 7     | `formatter.py`            | Add confidence scores, network stats, Louvain communities, temporal profiles         |

### Detection Algorithm Summary

| #   | Strategy                  | What It Catches                                   | Algorithm Used                   |
| --- | ------------------------- | ------------------------------------------------- | -------------------------------- |
| 1   | Circular Fund Routing     | Money flowing in loops (A→B→C→A)                  | Johnson's cycle enumeration      |
| 2   | Smurfing (Fan-in/Fan-out) | Many-to-one or one-to-many rapid transfers        | Two-pointer sliding window (72h) |
| 3   | Shell Layering            | Chains through near-inactive accounts             | Iterative DFS (stack-based)      |
| 4   | Round-trip Detection      | Similar amounts flowing A→B and B→A               | Bi-directional edge scan         |
| 5   | Amount Anomaly            | Sudden large transactions breaking normal pattern | Statistical 3σ deviation         |
| 6   | Rapid Movement            | Receive-then-forward within minutes               | Dwell-time two-pointer scan      |
| 7   | Amount Structuring        | Repeated transactions just below $10K             | Sub-threshold band scan          |

---

## 5. Feasibility

### Technical Feasibility

| Concern                       | Evidence                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| **Can it process real data?** | Handles 10,000 transactions in <5 seconds on a standard laptop                                  |
| **Do the algorithms scale?**  | O(n log n) fan detection, O(E) round-trip scan, cycle detection bounded by 20s timeout          |
| **Is it accurate?**           | 7 independent detectors cross-corroborate — multi-pattern accounts get higher scores            |
| **Can it handle bad data?**   | Parser handles encoding issues, missing fields, duplicates, self-transfers, negative amounts    |
| **Is it deployable?**         | Single FastAPI process + static frontend — runs on any cloud platform (Render, Railway, Vercel) |

### Resource Requirements

| Resource      | Requirement                  |
| ------------- | ---------------------------- |
| CPU           | Any modern processor         |
| RAM           | ~200 MB for 10K transactions |
| Disk          | ~50 MB (code + dependencies) |
| Python        | 3.10+                        |
| Node.js       | 18+                          |
| GPU           | Not required                 |
| Database      | Not required                 |
| Training data | Not required                 |

### What's Already Built and Working

- All 7 detection algorithms — tested and verified
- All 4 enrichment layers (anomaly, rapid movement, structuring, risk explanations)
- Interactive graph visualization with color-coded suspicious nodes
- Downloadable JSON report in exact hackathon spec format
- Full CSV validation with detailed error reporting
- Louvain community detection, confidence scores, temporal profiles

---

## 6. Viability

### Short-Term Viability (Hackathon)

| Requirement                              | Status                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| CSV upload and processing                | Complete                                                |
| Fraud ring detection (3 patterns)        | Complete (7 patterns implemented — exceeds requirement) |
| Suspicion scoring (0–100)                | Complete                                                |
| Interactive graph visualization          | Complete                                                |
| Fraud rings + suspicious accounts tables | Complete                                                |
| Downloadable JSON output                 | Complete                                                |
| Processing within 30s budget             | Complete (<5s for 10K rows)                             |
| False positive control                   | Complete (merchant exclusion, min-sample rules)         |

### Long-Term Viability (Production)

| Enhancement                        | Effort | Impact                                              |
| ---------------------------------- | ------ | --------------------------------------------------- |
| Database persistence               | Medium | Store results for historical trend analysis         |
| Real-time streaming ingestion      | High   | Process transactions as they arrive, not batch      |
| Multi-bank federation              | High   | Cross-institutional detection via secure APIs       |
| ML layer on top of graph features  | Medium | Supervised learning using scored accounts as labels |
| Role-based access control          | Low    | Restrict who can upload/view sensitive data         |
| Alert integration (email/Slack)    | Low    | Notify investigators when high-risk rings found     |
| Regulatory report generation (SAR) | Medium | Auto-generate FinCEN Suspicious Activity Reports    |

### Why It's Sustainable

- **No vendor lock-in** — 100% open-source stack (Python, React, NetworkX)
- **No recurring costs** — No ML model hosting, no GPU instances, no database licensing
- **Configurable** — All 18+ thresholds are adjustable via environment variables without code changes
- **Extensible** — Adding a new detector means creating one Python file and wiring it into the pipeline

---

## 7. Strategies

### Detection Strategies (How We Catch Criminals)

| Strategy            | How It Works (Simple)                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| **Circular Flow**   | Find money going in loops (A→B→C→A) — normal people don't do this      |
| **Fan-in/Fan-out**  | Find accounts receiving from 10+ sources in 3 days — that's a mule hub |
| **Shell Chains**    | Find chains of inactive accounts acting as pass-throughs               |
| **Round-tripping**  | Find two accounts sending similar money back and forth — fake activity |
| **Amount Spikes**   | Find accounts with a sudden huge transaction breaking their pattern    |
| **Fast Forwarding** | Find accounts that forward money within minutes of receiving it        |
| **Structuring**     | Find accounts making repeated transactions just below $10,000          |

### Scoring Strategy (How We Rank Danger)

Instead of a binary "suspicious / not suspicious", we assign a **0–100 risk score** combining:

- Pattern type and severity (cycle = 35 pts, fan-in = 28 pts, shell = 22 pts)
- Number of rings the account appears in (+10 per extra ring)
- Transaction velocity (+15 if >5 tx/day)
- Network centrality (up to +10 for hub accounts)
- Amount anomaly (+18), rapid movement (+20), structuring (+15)

**Result:** Investigators see a ranked list — score 87 gets investigated before score 23.

### False Positive Strategy (How We Avoid Catching Innocent People)

- **Merchant exclusion** — Accounts in the top 2% of both sending AND receiving are skipped (e.g., Amazon, payroll)
- **Minimum sample sizes** — Anomaly detection requires ≥5 transactions; structuring requires ≥3
- **Endpoint rules** — Shell chains must start and end at active accounts
- **Confidence scores** — Each ring gets a 0.0–1.0 confidence so investigators know what to prioritize

---

## 8. Impact & Benefits

### For Investigators

| Benefit                   | Before Our Tool                    | After Our Tool                           |
| ------------------------- | ---------------------------------- | ---------------------------------------- |
| **Time to detect a ring** | Days to weeks of manual review     | Under 5 seconds, fully automated         |
| **Skill required**        | Expert knowledge of graph patterns | Upload CSV → read results                |
| **Actionable output**     | Raw transaction logs               | Ranked accounts + English explanations   |
| **Network visibility**    | Spreadsheet rows                   | Interactive graph with clusters visible  |
| **Report generation**     | Manual SAR writing                 | Copy risk explanation directly into SAR  |
| **Prioritization**        | Gut feeling                        | 0–100 score with transparent methodology |

### For Financial Institutions

| Benefit                        | Detail                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| **Regulatory compliance**      | Automated detection of structuring (31 USC § 5324) and CTR evasion      |
| **Reduced investigation cost** | Automated scoring eliminates hours of manual case building              |
| **Fewer false positives**      | Multi-pattern corroboration and merchant exclusion reduce wasted effort |
| **Audit trail**                | Every detection has a confidence score and explanation — defensible     |
| **Scalability**                | 10,000 transactions in <5s — handles daily batch processing             |

### For Society

| Benefit                              | Detail                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------- |
| **Disrupts criminal infrastructure** | Identifying mule networks cuts the pipeline criminals depend on            |
| **Protects vulnerable mules**        | Early detection can stop unknowing mules before they face prosecution      |
| **Deters recruitment**               | If mule networks are detected quickly, recruitment becomes less profitable |
| **Recovers stolen funds**            | Faster detection = higher chance of freezing funds before they disappear   |

### Measurable Outcomes

| Metric                              | Impact                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| Detection speed                     | Manual: days → Automated: <5 seconds                      |
| Patterns detected                   | Traditional: 1–2 → Our engine: 7 patterns + 4 enrichments |
| False positive reduction            | Merchant exclusion + multi-factor scoring                 |
| Investigator productivity           | 10× more cases reviewable per day                         |
| Time from data to actionable report | Upload → results in one click                             |

---

## Summary

The Financial Forensics Engine addresses the $2 trillion money laundering problem by applying graph theory and statistical analysis to transaction data. It detects 7 distinct muling patterns, scores every account on a transparent 0–100 scale, and delivers results through an interactive visualization — all in under 5 seconds. The solution requires no training data, no database, and no GPU — making it immediately deployable and practically useful for any financial institution fighting money muling.
