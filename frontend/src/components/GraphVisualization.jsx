import { useCallback, useRef, useState, useMemo, useEffect } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import './GraphVisualization.css'

/* ── Pattern → Color mapping (3D/Warm Palette) ──────────────── */
const NODE_STYLES = {
  safe:     { color: '#84cc16', label: 'Safe',     shadow: '#65a30d' },
  cycle:    { color: '#ef4444', label: 'Cycle',    shadow: '#b91c1c' },
  fan_in:   { color: '#f97316', label: 'Fan-in',   shadow: '#c2410c' },
  fan_out:  { color: '#fb923c', label: 'Fan-out',  shadow: '#ea580c' },
  shell:    { color: '#fbbf24', label: 'Shell',    shadow: '#d97706' },
  velocity: { color: '#a3e635', label: 'Velocity', shadow: '#4d7c0f' },
  multi:    { color: '#f43f5e', label: 'Multi',    shadow: '#be123c' },
  default:  { color: '#f59e0b', label: 'Suspicious', shadow: '#b45309' },
}

function getNodeStyle(node) {
  if (!node.suspicious) return NODE_STYLES.safe
  const p = node.detected_patterns || []
  if (p.some(x => x.startsWith('cycle'))) return NODE_STYLES.cycle
  if (p.includes('fan_in')) return NODE_STYLES.fan_in
  if (p.includes('fan_out')) return NODE_STYLES.fan_out
  if (p.includes('shell_chain')) return NODE_STYLES.shell
  if (p.includes('high_velocity')) return NODE_STYLES.velocity
  if (p.length > 1) return NODE_STYLES.multi
  return NODE_STYLES.default
}

function getNodeSize(node) {
  if (!node.suspicious) return 20 // Smaller safe nodes
  const score = node.suspicion_score || 0
  return 24 + (score / 100) * 20 // 24-44px for suspicious
}

/* ── Cytoscape Stylesheet (3D Effects) ──────────────────────── */
const cyStylesheet = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'width': 'data(size)',
      'height': 'data(size)',
      'label': 'data(label)',
      'color': '#cbd5e1', // text-muted
      'text-valign': 'bottom',
      'text-halign': 'center',
      'font-size': '10px',
      'font-family': 'Inter, sans-serif',
      'font-weight': 500,
      'text-margin-y': 6,
      'text-background-color': '#18181b', // bg-dark
      'text-background-opacity': 0.8,
      'text-background-padding': '2px',
      'text-background-shape': 'roundrectangle',
      
      // 3D Rim Light & Shadow
      'border-width': 2,
      'border-color': 'rgba(255,255,255,0.4)', // Inner rim light
      'border-opacity': 0.5,
      'shadow-blur': 12,
      'shadow-color': 'data(shadowColor)',
      'shadow-opacity': 0.6,
      'shadow-offset-y': 4,
      
      'z-index': 10,
      'transition-property': 'background-color, border-width, border-color, shadow-blur',
      'transition-duration': '0.3s',
    }
  },
  {
    selector: 'node.safe',
    style: {
      'border-width': 1,
      'border-color': 'rgba(255,255,255,0.2)',
      'shadow-blur': 0,
    }
  },
  {
    selector: ':selected',
    style: {
      'border-width': 4,
      'border-color': '#ffffff',
      'shadow-blur': 25,
      'shadow-opacity': 0.8,
      'shadow-offset-y': 6,
      'z-index': 999,
    }
  },
  {
    selector: '.highlighted',
    style: {
      'border-width': 3,
      'border-color': '#ffffff',
      'shadow-blur': 20,
      'shadow-color': '#f97316',
      'z-index': 99,
    }
  },
  {
    selector: '.dimmed',
    style: {
      'opacity': 0.15,
      'shadow-opacity': 0,
      'z-index': 1,
    }
  },
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#52525b', // zinc-600
      'opacity': 0.3,
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#52525b',
    }
  },
  {
    selector: 'edge.suspicious-edge',
    style: {
      'line-color': '#ea580c', // orange-600
      'target-arrow-color': '#ea580c',
      'opacity': 0.6,
    }
  },
  {
    selector: 'edge:selected',
    style: {
      'width': 3,
      'line-color': '#fb923c', // orange-400
      'target-arrow-color': '#fb923c',
      'opacity': 1,
      'z-index': 99,
    }
  },
  {
    selector: 'edge.highlighted',
    style: {
      'width': 2.5,
      'line-color': '#f97316',
      'target-arrow-color': '#f97316',
      'opacity': 0.9,
      'z-index': 90,
    }
  }
]

/* ── Layout Options ────────────────────────────────────────── */
const LAYOUT_OPTIONS = {
  name: 'cose',
  animate: true,
  animationDuration: 800,
  randomize: false,
  componentSpacing: 100,
  nodeRepulsion: 12000,
  nodeOverlap: 20,
  idealEdgeLength: 80,
  edgeElasticity: 200,
  nestingFactor: 1.2,
  gravity: 0.25,
  numIter: 1000,
  initialTemp: 200,
  coolingFactor: 0.95,
  minTemp: 1.0,
  fit: true,
  padding: 60,
}

export default function GraphVisualization({ graphData, rings }) {
  const cyRef = useRef(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [filter, setFilter] = useState('all')
  const [activeRingId, setActiveRingId] = useState(null)
  const [layoutName, setLayoutName] = useState('cose')

  // Ring Highlight Logic
  const ringMembers = useMemo(() => {
    if (!rings || !activeRingId) return new Set()
    const r = rings.find(x => x.ring_id === activeRingId)
    return r ? new Set(r.member_accounts) : new Set()
  }, [rings, activeRingId])

  // Process Elements
  const elements = useMemo(() => {
    if (!graphData?.nodes) return []
    let nodes = graphData.nodes

    // Filter Logic
    if (filter === 'suspicious') nodes = nodes.filter(n => n.suspicious)
    else if (filter === 'safe') nodes = nodes.filter(n => !n.suspicious)

    // Map to Cytoscape format
    const nodeEles = nodes.map(n => {
      const style = getNodeStyle(n)
      return {
        data: {
          id: n.id,
          label: n.id.slice(0,4) + '...', // Short label
          fullLabel: n.id,
          suspicious: n.suspicious,
          score: n.suspicion_score,
          color: style.color,
          shadowColor: style.shadow,
          size: getNodeSize(n),
          ...n // pass all props
        },
        classes: n.suspicious ? 'suspicious' : 'safe'
      }
    })

    const visibleIds = new Set(nodeEles.map(x => x.data.id))
    const edgeEles = graphData.edges
      .filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e, idx) => ({
        data: {
          id: `e${idx}`,
          source: e.source,
          target: e.target,
          ...e
        },
        classes: (visibleIds.has(e.source) && graphData.nodes.find(n => n.id === e.source)?.suspicious) 
                 || (visibleIds.has(e.target) && graphData.nodes.find(n => n.id === e.target)?.suspicious)
                 ? 'suspicious-edge' : ''
      }))

    return [...nodeEles, ...edgeEles]
  }, [graphData, filter])

  // Visual Effect: Highlight Ring
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    
    cy.batch(() => {
      cy.elements().removeClass('highlighted dimmed')
      if (activeRingId && ringMembers.size > 0) {
        cy.nodes().forEach(n => {
          if (ringMembers.has(n.id())) n.addClass('highlighted')
          else n.addClass('dimmed')
        })
        cy.edges().forEach(e => {
          if (ringMembers.has(e.source().id()) && ringMembers.has(e.target().id())) {
            e.addClass('highlighted')
          } else {
            e.addClass('dimmed')
          }
        })
      }
    })
  }, [activeRingId, ringMembers, elements])

  // Handlers
  const handleCyInit = useCallback((cy) => {
    cyRef.current = cy
    cy.on('tap', 'node', (evt) => {
      setSelectedNode(evt.target.data())
    })
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelectedNode(null)
    })
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target
      setHoveredNode(node.data())
      setTooltipPos({ x: evt.originalEvent.clientX, y: evt.originalEvent.clientY })
      document.body.style.cursor = 'pointer'
    })
    cy.on('mouseout', 'node', () => {
      setHoveredNode(null)
      document.body.style.cursor = 'default'
    })
  }, [])

  const runLayout = () => {
    cyRef.current?.layout({ ...LAYOUT_OPTIONS, name: layoutName }).run()
  }

  useEffect(() => {
    runLayout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutName, elements]) // Re-run when layout or data changes

  // Stats
  const stats = useMemo(() => {
    const sCount = elements.filter(x => x.data?.suspicious).length
    const total = elements.filter(x => x.data?.source === undefined).length // nodes only
    return { total, suspicious: sCount, safe: total - sCount }
  }, [elements])

  if (!graphData?.nodes?.length) {
    return (
      <div className="graph-dashboard empty">
        <div className="center-msg">No Data to Visualize</div>
      </div>
    )
  }

  return (
    <div className="graph-dashboard">
      {/* ── Header Toolbar ────────────────────────────── */}
      <div className="graph-header">
        <div className="graph-title">Network Analysis</div>
        
        <div className="graph-controls-group">
          {/* Layout Select */}
          <select 
            className="graph-select" 
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
          >
            <option value="cose">Force Directed</option>
            <option value="circle">Circle</option>
            <option value="grid">Grid</option>
            <option value="breadthfirst">Hierarchical</option>
          </select>

           {/* Ring Select */}
           {rings?.length > 0 && (
            <select 
              className="graph-select"
              value={activeRingId || ''}
              onChange={(e) => setActiveRingId(e.target.value || null)}
            >
              <option value="">Select Ring...</option>
              {rings.map(r => (
                <option key={r.ring_id} value={r.ring_id}>
                  {r.ring_id} ({r.member_accounts.length} nodes)
                </option>
              ))}
            </select>
          )}

          {/* Filter Pills */}
          <div className="filter-pills">
            <button 
              className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({stats.total})
            </button>
            <button 
              className={`filter-pill ${filter === 'suspicious' ? 'active' : ''}`}
              onClick={() => setFilter('suspicious')}
            >
              Suspects ({stats.suspicious})
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────── */}
      <div className="graph-main-content">
        
        {/* Left: Graph Canvas */}
        <div className="graph-panel">
          <div className="cytoscape-container">
            <CytoscapeComponent
              elements={elements}
              stylesheet={cyStylesheet}
              layout={LAYOUT_OPTIONS}
              cy={handleCyInit}
              style={{ width: '100%', height: '100%' }}
              minZoom={0.2}
              maxZoom={5}
            />
          </div>
          
          <div className="zoom-controls-floating">
            <button className="zoom-btn" onClick={() => cyRef.current?.animate({ zoom: cyRef.current.zoom() * 1.3, duration: 200 })} title="Zoom In">+</button>
            <button className="zoom-btn" onClick={() => cyRef.current?.animate({ zoom: cyRef.current.zoom() * 0.7, duration: 200 })} title="Zoom Out">−</button>
            <button className="zoom-btn" onClick={() => cyRef.current?.fit(undefined, 50)} title="Fit">⊞</button>
            <button className="zoom-btn" onClick={runLayout} title="Redraw">↻</button>
          </div>

          {/* Tooltip Overlay */}
          {hoveredNode && !selectedNode && (
            <div 
              className="hover-tooltip"
              style={{ top: tooltipPos.y - 10, left: tooltipPos.x }}
            >
              <div 
                className="legend-dot" 
                style={{ background: hoveredNode.color, boxShadow: `0 0 8px ${hoveredNode.color}` }}
              />
              <span className="tooltip-id">{hoveredNode.id}</span>
              {hoveredNode.suspicious && (
                <span className="tooltip-score text-danger">({hoveredNode.score})</span>
              )}
            </div>
          )}
        </div>

        {/* Right: Sidebar Details */}
        <div className="details-sidebar">
          
          {/* Top Card: Selected Node Details OR Placeholder */}
          <div className="details-card flex-grow">
            <div className="card-header">
              <span>{selectedNode ? 'Node Details' : 'Selection'}</span>
              {selectedNode && (
                <button 
                  className="close-btn-simple" 
                  onClick={() => setSelectedNode(null)}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                >
                  ✕
                </button>
              )}
            </div>
            
            <div className="card-body">
              {selectedNode ? (
                <>
                  <div className="node-id-row">
                    <div 
                      className="node-status-dot" 
                      style={{ 
                        background: selectedNode.color, 
                        color: selectedNode.color /* used for shadow inheritance */
                      }} 
                    />
                    <div className="node-id-text" title={selectedNode.id}>
                      {selectedNode.id.length > 20 ? selectedNode.id.slice(0, 8) + '...' + selectedNode.id.slice(-8) : selectedNode.id}
                    </div>
                  </div>

                  {selectedNode.suspicious && (
                    <div className="score-section">
                      <div className="score-label-row">
                        <span>Risk Score</span>
                        <span style={{ color: selectedNode.score > 70 ? 'var(--danger)' : 'var(--warning)' }}>
                          {selectedNode.score}/100
                        </span>
                      </div>
                      <div className="score-track">
                        <div 
                          className="score-fill"
                          style={{ 
                            width: `${selectedNode.score}%`,
                            background: selectedNode.score > 70 ? 'var(--danger)' : 'var(--warning)'
                          }} 
                        />
                      </div>
                    </div>
                  )}

                  <div className="meta-grid">
                    <div className="meta-row">
                      <span className="meta-key">Transactions</span>
                      <span className="meta-val">{selectedNode.tx_count}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-key">Sent</span>
                      <span className="meta-val">${Number(selectedNode.total_sent).toLocaleString()}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-key">Received</span>
                      <span className="meta-val">${Number(selectedNode.total_received).toLocaleString()}</span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-key">Net Flow</span>
                      <span className={`meta-val ${selectedNode.net_flow >= 0 ? 'positive' : 'negative'}`}>
                        {selectedNode.net_flow >= 0 ? '+' : ''}${Number(selectedNode.net_flow).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {selectedNode.ring_ids?.length > 0 && (
                    <div className="tags-section">
                      <span className="tags-label">Member of Rings</span>
                      <div className="tags-list">
                        {selectedNode.ring_ids.map(rid => (
                          <span 
                            key={rid} 
                            className={`tag-chip clickable ring ${activeRingId === rid ? 'active-ring' : ''}`}
                            onClick={() => setActiveRingId(activeRingId === rid ? null : rid)}
                          >
                            {rid}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {selectedNode.detected_patterns?.length > 0 && (
                    <div className="tags-section">
                      <span className="tags-label">Patterns</span>
                      <div className="tags-list">
                        {selectedNode.detected_patterns.map(p => {
                          const style = Object.values(NODE_STYLES).find(s => s.label.toLowerCase() === p.split('_')[0]) || NODE_STYLES.default;
                          return (
                            <span 
                              key={p} 
                              className="tag-chip"
                              style={{ 
                                background: style.color + '22',
                                color: style.color,
                                border: '1px solid ' + style.color + '44'
                              }}
                            >
                              {p.replace(/_/g, ' ')}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                </>
              ) : (
                <div className="sidebar-empty">
                  <span>Select a node to view detailed transaction analysis</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Card: Legend */}
          <div className="details-card">
            <div className="card-header">Legend</div>
            <div className="card-body">
              <div className="legend-grid">
                {Object.values(NODE_STYLES).map((s, i) => (
                  <div key={i} className="legend-item">
                    <span 
                      className="legend-dot" 
                      style={{ background: s.color, boxShadow: `0 0 6px ${s.shadow}` }} 
                    />
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
