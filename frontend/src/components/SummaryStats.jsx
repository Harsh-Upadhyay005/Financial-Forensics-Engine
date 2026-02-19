import './SummaryStats.css'

export default function SummaryStats({ summary }) {
  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-icon">🏦</div>
        <div className="stat-value">{summary.total_accounts_analyzed.toLocaleString()}</div>
        <div className="stat-label">Accounts Analyzed</div>
      </div>
      <div className="stat-card danger">
        <div className="stat-icon">⚠️</div>
        <div className="stat-value">{summary.suspicious_accounts_flagged.toLocaleString()}</div>
        <div className="stat-label">Suspicious Accounts</div>
      </div>
      <div className="stat-card purple">
        <div className="stat-icon">🔴</div>
        <div className="stat-value">{summary.fraud_rings_detected.toLocaleString()}</div>
        <div className="stat-label">Fraud Rings Detected</div>
      </div>
      <div className="stat-card teal">
        <div className="stat-icon">⚡</div>
        <div className="stat-value">{summary.processing_time_seconds}s</div>
        <div className="stat-label">Processing Time</div>
      </div>
    </div>
  )
}
