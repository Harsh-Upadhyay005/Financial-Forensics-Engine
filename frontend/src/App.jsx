import { useState } from 'react'
import FileUpload from './components/FileUpload'
import GraphVisualization from './components/GraphVisualization'
import SummaryTable from './components/SummaryTable'
import DownloadButton from './components/DownloadButton'
import SummaryStats from './components/SummaryStats'
import './App.css'

export default function App() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('graph')

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-inner">
            <div className="logo">
              <span className="logo-icon">🔍</span>
              <div>
                <h1 className="logo-title">Financial Forensics Engine</h1>
                <p className="logo-subtitle">Money Muling Network Detection</p>
              </div>
            </div>
            {result && (
              <DownloadButton result={result} />
            )}
          </div>
        </div>
      </header>

      <main className="main container">
        {/* Upload Section */}
        <FileUpload
          onResult={setResult}
          onLoading={setLoading}
          onError={setError}
          loading={loading}
        />

        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loading-card">
            <div className="spinner" />
            <p>Analyzing transaction network…</p>
            <p className="loading-sub">Running cycle detection, smurfing analysis & shell network scan</p>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="results">
            <SummaryStats summary={result.summary} />

            {/* Tabs */}
            <div className="tabs">
              <button
                className={`tab ${activeTab === 'graph' ? 'active' : ''}`}
                onClick={() => setActiveTab('graph')}
              >
                📊 Network Graph
              </button>
              <button
                className={`tab ${activeTab === 'rings' ? 'active' : ''}`}
                onClick={() => setActiveTab('rings')}
              >
                🔴 Fraud Rings ({result.fraud_rings.length})
              </button>
              <button
                className={`tab ${activeTab === 'accounts' ? 'active' : ''}`}
                onClick={() => setActiveTab('accounts')}
              >
                ⚠️ Suspicious Accounts ({result.suspicious_accounts.length})
              </button>
            </div>

            {activeTab === 'graph' && (
              <GraphVisualization graphData={result.graph} />
            )}
            {activeTab === 'rings' && (
              <SummaryTable rings={result.fraud_rings} type="rings" />
            )}
            {activeTab === 'accounts' && (
              <SummaryTable accounts={result.suspicious_accounts} type="accounts" />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
