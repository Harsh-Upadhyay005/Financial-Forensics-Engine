import { useCallback, useRef, useState, useMemo, useEffect } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import coseBilkent from 'cytoscape-cose-bilkent'
import './GraphVisualization.css'

// Register layout extension once
cytoscape.use(coseBilkent)

/* ── Pattern → Color mapping ──────────────────────────────── */
const PATTERN_COLORS = {
  cycle_length_3:  '#f43f5e',
  cycle_length_4:  '#fb7185',
  cycle_length_5:  '#fda4af',
  fan_in:          '#a78bfa',
  fan_out:         '#8b5cf6',
  shell_chain:     '#fb923c',
  round_trip:      '#f59e0b',
  amount_anomaly:  '#ef4444',
  rapid_movement:  '#f97316',
  structuring:     '#eab308',
  high_velocity:   '#f59e0b',
  multi_ring:      '#fbbf24',
}

const PATTERN_LABELS = {
  cycle_length_3:  'Cycle (3)',
  cycle_length_4:  'Cycle (4)',
  cycle_length_5:  'Cycle (5)',
  fan_in:          'Fan-in',
  fan_out:         'Fan-out',
  shell_chain:     'Shell Chain',
  round_trip:      'Round Trip',
  amount_anomaly:  'Anomaly',
  rapid_movement:  'Rapid Move',
  structuring:     'Structuring',
  high_velocity:   'High Velocity',
  multi_ring:      'Multi Ring',
}

/* ── Node styling helpers ─────────────────────────────────── */
function getNodeColor(node) {
  if (!node.suspicious) return '#10b981'
  const p = node.detected_patterns || []
  if (p.some(x => x.startsWith('cycle')))    return '#f43f5e'
  if (p.includes('fan_in'))                   return '#a78bfa'
  if (p.includes('fan_out'))                  return '#8b5cf6'
  if (p.includes('shell_chain'))              return '#fb923c'
  if (p.includes('round_trip'))               return '#f59e0b'
  if (p.includes('amount_anomaly'))           return '#ef4444'
  if (p.includes('rapid_movement'))           return '#f97316'
  if (p.includes('structuring'))              return '#eab308'
  if (p.includes('high_velocity'))            return '#f59e0b'
  return '#fbbf24'
}

function getNodeSize(node) {
  if (!node.suspicious) return 24
  const score = node.suspicion_score || 0
  return 28 + (score / 100) * 42
}

/* ── Edge width from transaction volume ───────────────────── */
function getEdgeWidth(amt, maxAmt) {
  return 1.5 + (amt / maxAmt) * 6.5
}

/* ── Legend items ──────────────────────────────────────────── */
const LEGEND = [
  { color: '#10b981',  label: 'Safe' },
  { color: '#f43f5e',  label: 'Cycle' },
  { color: '#a78bfa',  label: 'Fan-in' },
  { color: '#8b5cf6',  label: 'Fan-out' },
  { color: '#fb923c',  label: 'Shell' },
  { color: '#f59e0b',  label: 'Round Trip' },
  { color: '#ef4444',  label: 'Anomaly' },
  { color: '#f97316',  label: 'Rapid Move' },
  { color: '#eab308',  label: 'Structuring' },
  { color: '#f59e0b',  label: 'Velocity' },
]

/* ── Cytoscape Stylesheet ─────────────────────────────────── */
function getCyStylesheet(nodeCount) {
  // Hide labels on large graphs for performance
  const showLabels = nodeCount <= 200
  return [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'width': 'data(size)',
      'height': 'data(size)',
      'label': showLabels ? 'data(label)' : '',
      'font-size': '11px',
      'font-family': 'Inter, sans-serif',
      'font-weight': 500,
      'color': 'rgba(17, 24, 39, 0.9)',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 7,
      'text-outline-color': '#ffffff',
      'text-outline-width': 2.5,
      'border-width': 1.5,
      'border-color': '#ffffff',
      'border-opacity': 0.8,
      'overlay-padding': 6,
      'overlay-opacity': 0,
      'shadow-blur': 6,
      'shadow-color': 'rgba(0,0,0,0.15)',
      'shadow-opacity': 0.8,
      'shadow-offset-x': 0,
      'shadow-offset-y': 2,
    },
  },
  {
    selector: 'node[?suspicious]',
    style: {
      'border-width': 3,
      'border-color': 'data(color)',
      'border-opacity': 0.8,
      'shadow-blur': 18,
      'shadow-color': 'data(color)',
      'shadow-opacity': 0.55,
      'font-weight': 700,
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 4,
      'border-color': '#4f46e5',
      'shadow-blur': 28,
      'shadow-color': '#4f46e5',
      'shadow-opacity': 0.6,
    },
  },
  {
    selector: 'node.dimmed',
    style: {
      'opacity': 0.12,
    },
  },
  {
    selector: 'node.ring-highlight',
    style: {
      'border-width': 4,
      'border-color': '#4f46e5',
      'border-style': 'dashed',
    },
  },
  {
    selector: 'edge',
    style: {
      'width': 'data(edgeWidth)',
      'line-color': 'rgba(100, 116, 139, 0.45)',
      'target-arrow-color': 'rgba(71, 85, 105, 0.7)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 1.1,
      'curve-style': 'bezier',
      'opacity': 0.75,
    },
  },
  {
    selector: 'edge.dimmed',
    style: {
      'opacity': 0.06,
    },
  },
  {
    selector: 'edge.ring-highlight',
    style: {
      'line-color': 'rgba(79,70,229,0.7)',
      'target-arrow-color': 'rgba(79,70,229,0.85)',
      'opacity': 1,
      'width': 3,
    },
  },
  {
    selector: 'node.hover',
    style: {
      'border-width': 3.5,
      'border-color': '#4f46e5',
      'shadow-blur': 22,
      'shadow-color': '#4f46e5',
      'shadow-opacity': 0.5,
    },
  },
  ]
}

/* ── Smart node limit for large datasets ──────────────────── */
const NODE_LIMIT = 300

/* ── Layout config (adaptive to graph size) ───────────────── */
function getLayoutConfig(nodeCount) {
  if (nodeCount > 500) {
    return {
      name: 'cose',
      animate: false,
      nodeOverlap: 20,
      idealEdgeLength: 80,
      nodeRepulsion: function () { return 4000 },
      numIter: 200,
      fit: true,
      padding: 30,
    }
  }
  if (nodeCount > 200) {
    return {
      name: 'cose-bilkent',
      quality: 'draft',
      animate: false,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: 100,
      nodeRepulsion: 5000,
      edgeElasticity: 0.45,
      gravity: 0.35,
      numIter: 300,
      tile: true,
      fit: true,
      padding: 30,
    }
  }
  return {
    name: 'cose-bilkent',
    quality: 'default',
    animate: false,
    nodeDimensionsIncludeLabels: true,
    idealEdgeLength: 120,
    nodeRepulsion: 6500,
    edgeElasticity: 0.45,
    nestingFactor: 0.1,
    gravity: 0.25,
    numIter: 600,
    tile: true,
    fit: true,
    padding: 40,
  }
}

export default function GraphVisualization({ graphData, rings }) {
  const cyRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [filter, setFilter] = useState('all') // all | suspicious | safe
  const [highlightRing, setHighlightRing] = useState(null)
  const [flowActive, setFlowActive] = useState(false)
  const [showAll, setShowAll] = useState(false)

  // Build ring member lookup
  const ringMembers = useMemo(() => {
    if (!rings) return new Set()
    if (!highlightRing) return new Set()
    const ring = rings.find(r => r.ring_id === highlightRing)
    return ring ? new Set(ring.member_accounts) : new Set()
  }, [rings, highlightRing])

  // Lookup map: nodeId → full node data (for detail panel, kept OUT of Cytoscape)
  const nodeDataMap = useMemo(() => {
    if (!graphData?.nodes?.length) return new Map()
    return new Map(graphData.nodes.map(n => [n.id, n]))
  }, [graphData])

  // Build Cytoscape elements with smart subgraph for large datasets
  const { elements, allNodeCount, isLimited } = useMemo(() => {
    if (!graphData?.nodes?.length) return { elements: [], allNodeCount: 0, isLimited: false }

    // Step 1: apply user filter
    let filteredNodes = graphData.nodes
    if (filter === 'suspicious') filteredNodes = filteredNodes.filter(n => n.suspicious)
    else if (filter === 'safe') filteredNodes = filteredNodes.filter(n => !n.suspicious)

    const allNodeCount = filteredNodes.length
    let nodes = filteredNodes
    let isLimited = false

    // Step 2: smart subgraph extraction for large datasets
    if (!showAll && nodes.length > NODE_LIMIT) {
      isLimited = true

      const suspicious = nodes
        .filter(n => n.suspicious)
        .sort((a, b) => (b.suspicion_score || 0) - (a.suspicion_score || 0))
      const suspiciousIds = new Set(suspicious.map(n => n.id))

      const filteredNodeIds = new Set(nodes.map(n => n.id))
      const neighborIds = new Set()
      graphData.edges.forEach(e => {
        if (suspiciousIds.has(e.source) && filteredNodeIds.has(e.target)) neighborIds.add(e.target)
        if (suspiciousIds.has(e.target) && filteredNodeIds.has(e.source)) neighborIds.add(e.source)
      })
      suspiciousIds.forEach(id => neighborIds.delete(id))

      const nodeMap = new Map(nodes.map(n => [n.id, n]))
      const prioritized = [...suspicious]

      for (const nid of neighborIds) {
        if (prioritized.length >= NODE_LIMIT) break
        if (nodeMap.has(nid)) prioritized.push(nodeMap.get(nid))
      }

      if (prioritized.length < NODE_LIMIT) {
        const usedIds = new Set(prioritized.map(n => n.id))
        const remaining = nodes
          .filter(n => !usedIds.has(n.id))
          .sort((a, b) => (b.tx_count || 0) - (a.tx_count || 0))
          .slice(0, NODE_LIMIT - prioritized.length)
        prioritized.push(...remaining)
      }

      nodes = prioritized.slice(0, NODE_LIMIT)
    }

    const visibleIds = new Set(nodes.map(n => n.id))

    // Minimal data pushed to Cytoscape — heavy fields stay in nodeDataMap
    const cyNodes = nodes.map(n => ({
      data: {
        id: n.id,
        label: n.label || n.id,
        color: getNodeColor(n),
        size: getNodeSize(n),
        suspicious: n.suspicious || false,
      },
    }))

    const visibleEdges = graphData.edges
      .filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))

    // Compute maxAmount ONCE (O(n)) instead of per-edge (was O(n²))
    let maxAmt = 1
    for (let i = 0; i < visibleEdges.length; i++) {
      const a = visibleEdges[i].total_amount || 0
      if (a > maxAmt) maxAmt = a
    }

    const cyEdges = visibleEdges.map((e, i) => ({
      data: {
        id: `edge-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        edgeWidth: getEdgeWidth(e.total_amount || 0, maxAmt),
      },
    }))

    return { elements: [...cyNodes, ...cyEdges], allNodeCount, isLimited }
  }, [graphData, filter, showAll])

  // Apply ring highlighting classes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    // Clear all existing classes
    cy.elements().removeClass('dimmed ring-highlight')

    if (highlightRing && ringMembers.size > 0) {
      // Dim all elements first
      cy.elements().addClass('dimmed')

      // Highlight ring members
      ringMembers.forEach(memberId => {
        const node = cy.getElementById(memberId)
        if (node.length) {
          node.removeClass('dimmed').addClass('ring-highlight')
        }
      })

      // Highlight edges between ring members
      cy.edges().forEach(edge => {
        const src = edge.source().id()
        const tgt = edge.target().id()
        if (ringMembers.has(src) && ringMembers.has(tgt)) {
          edge.removeClass('dimmed').addClass('ring-highlight')
        }
      })
    }
  }, [highlightRing, ringMembers])

  // Edge flow animation — animated dashes with requestAnimationFrame
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    if (!flowActive) {
      if (!cy.destroyed()) {
        cy.edges().style({ 'line-style': 'solid', 'line-dash-offset': 0 })
      }
      return
    }

    const edgeCount = cy.edges().length
    // Skip animation entirely for very large graphs
    if (edgeCount > 600) {
      cy.edges().style({ 'line-style': 'dashed', 'line-dash-pattern': [8, 4] })
      return
    }

    cy.edges().style({ 'line-style': 'dashed', 'line-dash-pattern': [8, 4] })

    let offset = 0
    let lastTime = 0
    const frameInterval = edgeCount > 300 ? 80 : edgeCount > 100 ? 50 : 30
    let rafId

    const animate = (timestamp) => {
      if (cy.destroyed()) return
      if (timestamp - lastTime >= frameInterval) {
        lastTime = timestamp
        offset = (offset - 2) % 24
        cy.startBatch()
        cy.edges().style('line-dash-offset', offset)
        cy.endBatch()
      }
      rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafId)
      if (cy && !cy.destroyed()) {
        cy.edges().style({ 'line-style': 'solid', 'line-dash-offset': 0 })
      }
    }
  }, [flowActive, elements])

  // Cytoscape init callback
  const handleCyInit = useCallback((cy) => {
    cyRef.current = cy

    cy.on('tap', 'node', (evt) => {
      setSelected(evt.target.id())
      cy.animate({ center: { eles: evt.target }, zoom: 2.5, duration: 400 })
    })

    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null)
    })

    cy.on('mouseover', 'node', (evt) => {
      setHovered(evt.target.id())
      evt.target.addClass('hover')
      document.body.style.cursor = 'pointer'
    })

    cy.on('mouseout', 'node', (evt) => {
      setHovered(null)
      evt.target.removeClass('hover')
      document.body.style.cursor = 'default'
    })
  }, [])

  // Zoom controls
  const zoomIn = () => {
    const cy = cyRef.current
    if (cy) cy.animate({ zoom: cy.zoom() * 1.4, duration: 300 })
  }
  const zoomOut = () => {
    const cy = cyRef.current
    if (cy) cy.animate({ zoom: cy.zoom() * 0.7, duration: 300 })
  }
  const fitView = () => {
    const cy = cyRef.current
    if (cy) cy.fit(undefined, 40)
  }

  if (!graphData?.nodes?.length) {
    return (
      <div className="graph-empty">
        <div className="empty-icon">◉</div>
        <p>No graph data available</p>
      </div>
    )
  }

  // Memoize counts to avoid re-scanning on every render
  const { suspiciousCount, safeCount } = useMemo(() => {
    const s = graphData.nodes.filter(n => n.suspicious).length
    return { suspiciousCount: s, safeCount: graphData.nodes.length - s }
  }, [graphData])

  const { visibleNodeCount, visibleEdgeCount } = useMemo(() => {
    let nc = 0, ec = 0
    for (const el of elements) { if (el.data.source) ec++; else nc++ }
    return { visibleNodeCount: nc, visibleEdgeCount: ec }
  }, [elements])

  const activeLayout = useMemo(() => getLayoutConfig(visibleNodeCount), [visibleNodeCount])
  const activeStylesheet = useMemo(() => getCyStylesheet(visibleNodeCount), [visibleNodeCount])

  return (
    <div className="graph-container">
      {/* ── Toolbar ───────────────────────────────────────── */}
      <div className="graph-toolbar">
        <div className="graph-toolbar-left">
          {/* Legend */}
          <div className="legend-group">
            {LEGEND.map(l => (
              <div key={l.label} className="legend-item">
                <span className="legend-dot" style={{ background: l.color }} />
                <span>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="graph-toolbar-right">
          {/* Ring filter */}
          {rings && rings.length > 0 && (
            <select
              className="graph-select"
              value={highlightRing || ''}
              onChange={e => setHighlightRing(e.target.value || null)}
            >
              <option value="">All Rings</option>
              {rings.map(r => (
                <option key={r.ring_id} value={r.ring_id}>
                  {r.ring_id} — {r.pattern_type} ({r.member_accounts.length})
                </option>
              ))}
            </select>
          )}

          {/* Node filter */}
          <div className="filter-pills">
            {[
              { key: 'all', label: `All (${graphData.nodes.length})` },
              { key: 'suspicious', label: `Flagged (${suspiciousCount})` },
              { key: 'safe', label: `Safe (${safeCount})` },
            ].map(f => (
              <button
                key={f.key}
                className={`filter-pill ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Zoom controls */}
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={zoomIn} title="Zoom in">+</button>
            <button className="zoom-btn" onClick={zoomOut} title="Zoom out">−</button>
            <button className="zoom-btn" onClick={fitView} title="Fit view">⊞</button>
          </div>

          {/* Flow animation toggle */}
          <button
            className={`flow-toggle-btn ${flowActive ? 'active' : ''}`}
            onClick={() => setFlowActive(f => !f)}
            title={flowActive ? 'Stop flow animation' : 'Show money flow direction'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            <span>Flow</span>
          </button>

          {/* Show all toggle (only when limited) */}
          {isLimited && (
            <button
              className="show-all-btn"
              onClick={() => setShowAll(true)}
              title={`Showing ${visibleNodeCount} of ${allNodeCount} nodes. Click to show all (may be slow).`}
            >
              Show All ({allNodeCount})
            </button>
          )}
          {showAll && allNodeCount > NODE_LIMIT && (
            <button
              className="show-all-btn active"
              onClick={() => setShowAll(false)}
              title="Switch back to smart view"
            >
              Smart View
            </button>
          )}
        </div>
      </div>

      {/* ── Graph Canvas (Cytoscape) ──────────────────────── */}
      <div className="graph-canvas">
        <CytoscapeComponent
          key={`cy-${filter}-${showAll}`}
          elements={elements}
          stylesheet={activeStylesheet}
          layout={activeLayout}
          cy={handleCyInit}
          style={{ width: '100%', height: '580px' }}
          userZoomingEnabled={true}
          userPanningEnabled={true}
          boxSelectionEnabled={false}
          autoungrabify={false}
          wheelSensitivity={0.3}
        />
      </div>

      {/* ── Hover tooltip ─────────────────────────────────── */}
      {hovered && !selected && (() => {
        const h = nodeDataMap.get(hovered)
        if (!h) return null
        return (
          <div className="hover-tooltip">
            <span className="tooltip-dot" style={{ background: getNodeColor(h) }} />
            <span className="tooltip-id">{h.id}</span>
            {h.suspicious && (
              <span className="tooltip-score">Score: {h.suspicion_score}</span>
            )}
          </div>
        )
      })()}

      {/* ── Node Detail Panel ─────────────────────────────── */}
      {selected && (() => {
        const sel = nodeDataMap.get(selected)
        if (!sel) return null
        const selColor = getNodeColor(sel)
        return (
        <div className="node-panel">
          <div className="node-panel-header">
            <div className="panel-title-row">
              <span className="panel-dot" style={{ background: selColor }} />
              <h3>{sel.id}</h3>
            </div>
            <button className="close-btn" onClick={() => setSelected(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {sel.suspicious && (
            <div className="panel-score-bar">
              <div className="score-track">
                <div
                  className="score-fill"
                  style={{
                    width: `${sel.suspicion_score}%`,
                    background: sel.suspicion_score >= 70 ? 'var(--danger)' :
                                sel.suspicion_score >= 40 ? 'var(--warning)' : 'var(--safe)',
                  }}
                />
              </div>
              <span className="score-label">{sel.suspicion_score}/100</span>
            </div>
          )}

          <div className="node-panel-body">
            <div className="meta-grid">
              <div className="meta-item">
                <span className="meta-label">Transactions</span>
                <span className="meta-value">{sel.tx_count}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Total Sent</span>
                <span className="meta-value">${Number(sel.total_sent || 0).toLocaleString()}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Total Received</span>
                <span className="meta-value">${Number(sel.total_received || 0).toLocaleString()}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Net Flow</span>
                <span className={`meta-value ${(sel.net_flow || 0) >= 0 ? 'positive' : 'negative'}`}>
                  {(sel.net_flow || 0) >= 0 ? '+' : ''}${Number(sel.net_flow || 0).toLocaleString()}
                </span>
              </div>
              {sel.sent_count !== undefined && (
                <div className="meta-item">
                  <span className="meta-label">Sent Count</span>
                  <span className="meta-value">{sel.sent_count}</span>
                </div>
              )}
              {sel.received_count !== undefined && (
                <div className="meta-item">
                  <span className="meta-label">Recv Count</span>
                  <span className="meta-value">{sel.received_count}</span>
                </div>
              )}
              {sel.first_tx && (
                <div className="meta-item full">
                  <span className="meta-label">First Transaction</span>
                  <span className="meta-value mono">{sel.first_tx}</span>
                </div>
              )}
              {sel.last_tx && (
                <div className="meta-item full">
                  <span className="meta-label">Last Transaction</span>
                  <span className="meta-value mono">{sel.last_tx}</span>
                </div>
              )}
            </div>

            {/* Suspicious details */}
            {sel.suspicious && (
              <>
                {sel.risk_explanation && (
                  <div className="panel-section">
                    <span className="meta-label">Risk Explanation</span>
                    <p className="risk-explanation-text">{sel.risk_explanation}</p>
                  </div>
                )}
                {sel.ring_ids?.length > 0 && (
                  <div className="panel-section">
                    <span className="meta-label">Ring Membership</span>
                    <div className="ring-tags">
                      {sel.ring_ids.map(rid => (
                        <button
                          key={rid}
                          className={`ring-tag ${highlightRing === rid ? 'active' : ''}`}
                          onClick={() => setHighlightRing(highlightRing === rid ? null : rid)}
                        >
                          {rid}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {sel.detected_patterns?.length > 0 && (
                  <div className="panel-section">
                    <span className="meta-label">Detected Patterns</span>
                    <div className="pattern-tags">
                      {sel.detected_patterns.map(p => (
                        <span
                          key={p}
                          className="pattern-tag"
                          style={{
                            background: (PATTERN_COLORS[p] || '#a855f7') + '18',
                            color: PATTERN_COLORS[p] || '#a855f7',
                            border: `1px solid ${(PATTERN_COLORS[p] || '#a855f7')}33`,
                          }}
                        >
                          {PATTERN_LABELS[p] || p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {sel.temporal_profile && (
                  <div className="panel-section">
                    <span className="meta-label">Temporal Profile</span>
                    <div className="temporal-bar-chart">
                      {sel.temporal_profile.hourly_distribution.map((count, hour) => {
                        const maxCount = Math.max(...sel.temporal_profile.hourly_distribution, 1)
                        const heightPct = (count / maxCount) * 100
                        const isPeak = hour === sel.temporal_profile.peak_hour
                        return (
                          <div
                            key={hour}
                            className={`temporal-bar ${isPeak ? 'peak' : ''}`}
                            style={{ '--bar-height': `${Math.max(heightPct, 2)}%` }}
                            title={`${hour}:00 — ${count} tx${isPeak ? ' (peak)' : ''}`}
                          />
                        )
                      })}
                    </div>
                    <div className="temporal-meta">
                      <span>Peak: {sel.temporal_profile.peak_hour}:00</span>
                      <span>{sel.temporal_profile.active_hours}/24h active</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {sel.community_id != null && (
              <div className="panel-section">
                <span className="meta-label">Community</span>
                <span className="community-badge">Community #{sel.community_id}</span>
              </div>
            )}
          </div>
        </div>
        )
      })()}

      {/* ── Stats footer ──────────────────────────────────── */}
      <div className="graph-footer">
        <span>{visibleNodeCount}{isLimited ? ` of ${allNodeCount}` : ''} nodes</span>
        <span className="graph-footer-sep">•</span>
        <span>{visibleEdgeCount} edges</span>
        <span className="graph-footer-sep">•</span>
        <span className="text-danger">{suspiciousCount} flagged</span>
        {isLimited && (
          <>
            <span className="graph-footer-sep">•</span>
            <span className="text-accent">Smart view (suspicious network)</span>
          </>
        )}
        {flowActive && (
          <>
            <span className="graph-footer-sep">•</span>
            <span className="text-accent">Flow active</span>
          </>
        )}
        {highlightRing && (
          <>
            <span className="graph-footer-sep">•</span>
            <span className="text-accent">Highlighting: {highlightRing}</span>
          </>
        )}
        <span className="graph-footer-sep">•</span>
        <span className="text-muted-badge">Powered by Cytoscape.js</span>
      </div>
    </div>
  )
}
