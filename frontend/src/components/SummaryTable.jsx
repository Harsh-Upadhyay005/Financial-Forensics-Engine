import { useState, useMemo } from 'react'
import './SummaryTable.css'

/* ── Pattern badge config (Warm Palette) ───────────────────── */
const PATTERN_LABELS = {
  cycle_length_3: { label: 'Cycle ×3', color: '#ef4444' },
  cycle_length_4: { label: 'Cycle ×4', color: '#f87171' },
  cycle_length_5: { label: 'Cycle ×5', color: '#fbbf24' },
  fan_in:         { label: 'Fan-in',   color: '#f97316' },
  fan_out:        { label: 'Fan-out',  color: '#fb923c' },
  shell_chain:    { label: 'Shell Chain', color: '#fbbf24' },
  high_velocity:  { label: 'High Velocity', color: '#a3e635' },
  multi_ring:     { label: 'Multi-Ring', color: '#f43f5e' },
  cycle:          { label: 'Cycle',     color: '#ef4444' },
}

function PatternBadge({ pattern }) {
  const info = PATTERN_LABELS[pattern] || { label: pattern, color: '#f97316' }
  return (
    <span
      className="pattern-badge"
      style={{
        '--badge-color': info.color,
        background: info.color + '18',
        color: info.color,
        borderColor: info.color + '33',
      }}
    >
      {info.label}
    </span>
  )
}

function ScoreBar({ score }) {
  const pct = Math.min(100, Math.max(0, score))
  const color = pct >= 70 ? 'var(--danger)' : pct >= 40 ? '#facc15' : 'var(--accent2)'
  return (
    <div className="score-bar-wrap">
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="score-value" style={{ color }}>{score}</span>
    </div>
  )
}

/* ── Search icon ───────────────────────────────────────────── */
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

/* ── Chevron icon ──────────────────────────────────────────── */
const ChevronIcon = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

/* ══════════════════════════════════════════════════════════════ */
export default function SummaryTable({ rings, accounts, type }) {
  const [expandedRow, setExpandedRow] = useState(null)
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  /* ── sort handler ─────────────────────────────────────────── */
  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const SortArrow = ({ col }) => {
    if (sortCol !== col) return <span className="sort-arrow muted">↕</span>
    return <span className="sort-arrow active">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  /* ══════════════ RINGS TABLE ═══════════════════════════════ */
  if (type === 'rings') {
    const filtered = useMemo(() => {
      let arr = (rings || []).filter(r =>
        !search
        || r.ring_id.toLowerCase().includes(search.toLowerCase())
        || r.pattern_type.toLowerCase().includes(search.toLowerCase())
        || r.member_accounts.some(a => a.toLowerCase().includes(search.toLowerCase()))
      )
      if (sortCol === 'risk_score') arr = [...arr].sort((a, b) => sortDir === 'asc' ? a.risk_score - b.risk_score : b.risk_score - a.risk_score)
      if (sortCol === 'members') arr = [...arr].sort((a, b) => sortDir === 'asc' ? a.member_accounts.length - b.member_accounts.length : b.member_accounts.length - a.member_accounts.length)
      return arr
    }, [rings, search, sortCol, sortDir])

    return (
      <div className="table-container" style={{ animationDelay: '0.05s' }}>
        {/* Toolbar */}
        <div className="table-toolbar">
          <div className="search-wrap">
            <SearchIcon />
            <input
              className="search-input"
              type="text"
              placeholder="Search rings, patterns, accounts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span className="table-count">{filtered.length} ring{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-table">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <p>No fraud rings detected</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ring ID</th>
                  <th>Pattern</th>
                  <th className="sortable" onClick={() => handleSort('members')}>Members <SortArrow col="members" /></th>
                  <th className="sortable" onClick={() => handleSort('risk_score')}>Risk Score <SortArrow col="risk_score" /></th>
                  <th>Member Accounts</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ring, idx) => {
                  const isExp = expandedRow === ring.ring_id
                  const preview = ring.member_accounts.slice(0, 3)
                  const hasMore = ring.member_accounts.length > 3
                  return (
                    <tr key={ring.ring_id} className={isExp ? 'expanded' : ''} style={{ animationDelay: `${idx * 0.02}s` }}>
                      <td>
                        <span className="ring-pill">{ring.ring_id}</span>
                      </td>
                      <td>
                        <PatternBadge pattern={ring.pattern_type} />
                      </td>
                      <td className="count-cell">{ring.member_accounts.length}</td>
                      <td>
                        <ScoreBar score={ring.risk_score} />
                      </td>
                      <td className="accounts-cell">
                        <div className="acct-list">
                          {(isExp ? ring.member_accounts : preview).map(a => (
                            <span key={a} className="acct-chip">{a}</span>
                          ))}
                          {hasMore && (
                            <button
                              className="expand-btn"
                              onClick={() => setExpandedRow(isExp ? null : ring.ring_id)}
                            >
                              <ChevronIcon open={isExp} />
                              {isExp ? 'less' : `+${ring.member_accounts.length - 3}`}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  /* ══════════════ ACCOUNTS TABLE ════════════════════════════ */
  const filtered = useMemo(() => {
    let arr = (accounts || []).filter(a =>
      !search
      || a.account_id.toLowerCase().includes(search.toLowerCase())
      || a.ring_id.toLowerCase().includes(search.toLowerCase())
      || a.detected_patterns.some(p => p.toLowerCase().includes(search.toLowerCase()))
    )
    if (sortCol === 'score') arr = [...arr].sort((a, b) => sortDir === 'asc' ? a.suspicion_score - b.suspicion_score : b.suspicion_score - a.suspicion_score)
    return arr
  }, [accounts, search, sortCol, sortDir])

  return (
    <div className="table-container" style={{ animationDelay: '0.05s' }}>
      <div className="table-toolbar">
        <div className="search-wrap">
          <SearchIcon />
          <input
            className="search-input"
            type="text"
            placeholder="Search account IDs, patterns, rings…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="table-count">{filtered.length} account{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-table">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <p>No suspicious accounts detected</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account ID</th>
                <th className="sortable" onClick={() => handleSort('score')}>Suspicion Score <SortArrow col="score" /></th>
                <th>Detected Patterns</th>
                <th>Ring ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc, i) => (
                <tr key={acc.account_id} style={{ animationDelay: `${i * 0.02}s` }}>
                  <td className="idx-cell">{i + 1}</td>
                  <td><span className="acc-id">{acc.account_id}</span></td>
                  <td>
                    <ScoreBar score={acc.suspicion_score} />
                  </td>
                  <td>
                    <div className="pattern-tags">
                      {acc.detected_patterns.map(p => (
                        <PatternBadge key={p} pattern={p} />
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className="ring-pill">{acc.ring_id}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
