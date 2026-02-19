import './DownloadButton.css'

export default function DownloadButton({ result }) {
  const handleDownload = () => {
    // Build the exact required JSON structure (strip graph data)
    const output = {
      suspicious_accounts: result.suspicious_accounts,
      fraud_rings: result.fraud_rings,
      summary: result.summary,
    }
    const blob = new Blob(
      [JSON.stringify(output, null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `forensics_report_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button className="download-btn" onClick={handleDownload}>
      ⬇ Download Report JSON
    </button>
  )
}
