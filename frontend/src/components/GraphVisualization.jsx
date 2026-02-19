import { useCallback, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import './GraphVisualization.css'

const PATTERN_COLORS = {
  cycle_length_3: '#ff4d6d',
  cycle_length_4: '#ff6b35',
  cycle_length_5: '#ffd166',
  fan_in: '#c77dff',
  fan_out: '#7b2fff',
  shell_chain: '#00b4d8',
  high_velocity: '#f77f00',
}

function getNodeColor(node) {
  if (!node.suspicious) return '#4ade80'
  if (node.detected_patterns?.some(p => p.startsWith('cycle'))) return '#ff4d6d'
  if (node.detected_patterns?.some(p => p.includes('fan'))) return '#c77dff'
  if (node.detected_patterns?.includes('shell_chain')) return '#00b4d8'
  return '#ffd166'
}

function getNodeSize(node) {
  if (!node.suspicious) return 4
  const score = node.suspicion_score || 0
  return 4 + (score / 100) * 12
}

export default function GraphVisualization({ graphData }) {
  const fgRef = useRef()
  const [selected, setSelected] = useState(null)
  const [hovered, setHovered] = useState(null)

  const handleNodeClick = useCallback((node) => {
    setSelected(node)
    if (fgRef.current) {
      fgRef.current.centerAt(node.x, node.y, 500)
      fgRef.current.zoom(4, 500)
    }
  }, [])

  const handleNodeHover = useCallback((node) => {
    setHovered(node)
    document.body.style.cursor = node ? 'pointer' : 'default'
  }, [])

  const handleBgClick = useCallback(() => setSelected(null), [])

  const paintNode = useCallback((node, ctx, globalScale) => {
    const size = getNodeSize(node)
    const color = getNodeColor(node)
    const isHighlighted = hovered?.id === node.id || selected?.id === node.id

    // Glow effect for suspicious nodes
    if (node.suspicious) {
      ctx.shadowColor = color
      ctx.shadowBlur = isHighlighted ? 20 : 10
    }

    // Node circle
    ctx.beginPath()
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()

    // Border for highlighted
    if (isHighlighted) {
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.shadowBlur = 0

    // Label (only when zoomed in enough)
    if (globalScale > 1.5 || node.suspicious) {
      const label = node.label
      const fontSize = Math.max(10 / globalScale, 6)
      ctx.font = `${fontSize}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#e2e8f0'
      ctx.fillText(label, node.x, node.y + size + 2)
    }
  }, [hovered, selected])

  if (!graphData?.nodes?.length) {
    return (
      <div className="graph-empty">
        <p>No graph data available.</p>
      </div>
    )
  }

  const suspiciousCount = graphData.nodes.filter(n => n.suspicious).length
  const safeCount = graphData.nodes.length - suspiciousCount

  return (
    <div className="graph-container">
      {/* Legend */}
      <div className="graph-legend">
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#4ade80' }} />
          Safe ({safeCount})
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#ff4d6d' }} />
          Cycle
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#c77dff' }} />
          Fan-in/out
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#00b4d8' }} />
          Shell
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#ffd166' }} />
          Multi-pattern
        </div>
        <span className="legend-sep" />
        <span className="legend-tip">Larger nodes = higher suspicion score • Click a node for details</span>
      </div>

      {/* Graph */}
      <div className="graph-canvas">
        <ForceGraph2D
          ref={fgRef}
          graphData={{
            nodes: graphData.nodes.map(n => ({ ...n })),
            links: graphData.edges.map(e => ({
              source: e.source,
              target: e.target,
              total_amount: e.total_amount,
              tx_count: e.tx_count,
            })),
          }}
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={handleBgClick}
          linkColor={() => 'rgba(148,163,184,0.25)'}
          linkWidth={0.8}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={() => 'rgba(108,99,255,0.7)'}
          backgroundColor="#0f1117"
          width={undefined}
          height={540}
          cooldownTicks={80}
        />
      </div>

      {/* Node Detail Panel */}
      {selected && (
        <div className="node-panel">
          <div className="node-panel-header">
            <h3>
              <span
                className="panel-dot"
                style={{ background: getNodeColor(selected) }}
              />
              {selected.id}
            </h3>
            <button className="close-btn" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div className="node-panel-body">
            <div className="meta-grid">
              <div className="meta-item">
                <span className="meta-label">Total Transactions</span>
                <span className="meta-value">{selected.tx_count}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Total Sent</span>
                <span className="meta-value">${selected.total_sent?.toLocaleString()}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Total Received</span>
                <span className="meta-value">${selected.total_received?.toLocaleString()}</span>
              </div>
              {selected.suspicious && (
                <>
                  <div className="meta-item">
                    <span className="meta-label">Suspicion Score</span>
                    <span className="meta-value score">{selected.suspicion_score}/100</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Ring ID</span>
                    <span className="meta-value">{selected.ring_id}</span>
                  </div>
                </>
              )}
            </div>
            {selected.detected_patterns?.length > 0 && (
              <div className="patterns-section">
                <span className="meta-label">Detected Patterns</span>
                <div className="pattern-tags">
                  {selected.detected_patterns.map(p => (
                    <span
                      key={p}
                      className="pattern-tag"
                      style={{ background: PATTERN_COLORS[p] || '#6c63ff' }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
