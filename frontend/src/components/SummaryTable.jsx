import { useState } from 'react'
import './SummaryTable.css'

const PATTERN_LABELS = {
  cycle_length_3: { label: 'Cycle (Len 3)', color: '#ff4d6d' },
  cycle_length_4: { label: 'Cycle (Len 4)', color: '#ff6b35' },
  cycle_length_5: { label: 'Cycle (Len 5)', color: '#ffd166' },
  fan_in: { label: 'Fan-in', color: '#c77dff' },
  fan_out: { label: 'Fan-out', color: '#7b2fff' },
  shell_chain: { label: 'Shell Chain', color: '#00b4d8' },
  high_velocity: { label: 'High Velocity', color: '#f77f00' },
  cycle: { label: 'Cycle', color: '#ff4d6d' },
}

function PatternBadge({ pattern }) {
  const info = PATTERN_LABELS[pattern] || { label: pattern, color: '#6c63ff' }
  return (
    <span className="pattern-badge" style={{ background: info.color + '22', color: info.color, border: `1px solid ${info.color}44` }}>
      {info.label}
    </span>
  )
}

function ScoreBar({ score }) {
  const color = score >= 70 ? '#ff4d6d' : score >= 40 ? '#ffd166' : '#4ade80'
  return (
    <div className="score-bar-wrap">
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="score-value" style={{ color }}>{score}</span>
    </div>
  )
}

export default function SummaryTable({ rings, accounts, type }) {
  const [expandedRow, setExpandedRow] = useState(null)
  const [search, setSearch] = useState('')

  if (type === 'rings') {
    const filtered = (rings || []).filter(r =>
      !search || r.ring_id.toLowerCase().includes(search.toLowerCase())
        || r.pattern_type.toLowerCase().includes(search.toLowerCase())
        || r.member_accounts.some(a => a.toLowerCase().includes(search.toLowerCase()))
    )

    return (
      <div className="table-container">
        <div className="table-toolbar">
          <input
            className="search-input"
            type="text"
            placeholder="Search rings, patterns, accounts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span className="table-count">{filtered.length} rings</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-table">No fraud rings detected.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ring ID</th>
                  <th>Pattern Type</th>
                  <th>Members</th>
                  <th>Risk Score</th>
                  <th>Member Account IDs</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ring) => {
                  const isExp = expandedRow === ring.ring_id
                  const preview = ring.member_accounts.slice(0, 3)
                  const hasMore = ring.member_accounts.length > 3
                  return (
                    <tr key={ring.ring_id} className={isExp ? 'expanded' : ''}>
                      <td>
                        <span className="ring-id">{ring.ring_id}</span>
                      </td>
                      <td>
                        <PatternBadge pattern={ring.pattern_type} />
                      </td>
                      <td className="count-cell">{ring.member_accounts.length}</td>
                      <td>
                        <ScoreBar score={ring.risk_score} />
                      </td>
                      <td className="accounts-cell">
                        {isExp
                          ? ring.member_accounts.join(', ')
                          : preview.join(', ')
                        }
                        {hasMore && (
                          <button
                            className="expand-btn"
                            onClick={() => setExpandedRow(isExp ? null : ring.ring_id)}
                          >
                            {isExp ? ' ▲ less' : ` +${ring.member_accounts.length - 3} more`}
                          </button>
                        )}
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

  // Accounts table
  const filtered = (accounts || []).filter(a =>
    !search || a.account_id.toLowerCase().includes(search.toLowerCase())
      || a.ring_id.toLowerCase().includes(search.toLowerCase())
      || a.detected_patterns.some(p => p.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="table-container">
      <div className="table-toolbar">
        <input
          className="search-input"
          type="text"
          placeholder="Search account IDs, patterns, rings…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="table-count">{filtered.length} accounts</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-table">No suspicious accounts detected.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account ID</th>
                <th>Suspicion Score</th>
                <th>Detected Patterns</th>
                <th>Ring ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc, i) => (
                <tr key={acc.account_id}>
                  <td className="idx-cell">{i + 1}</td>
                  <td className="acc-id">{acc.account_id}</td>
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
                    <span className="ring-id">{acc.ring_id}</span>
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
