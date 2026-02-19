import { useRef } from 'react'
import axios from 'axios'
import './FileUpload.css'

const SAMPLE_CSV = `transaction_id,sender_id,receiver_id,amount,timestamp
TXN_001,ACC_A,ACC_B,500.00,2024-01-01 10:00:00
TXN_002,ACC_B,ACC_C,490.00,2024-01-01 11:00:00
TXN_003,ACC_C,ACC_A,480.00,2024-01-01 12:00:00
TXN_004,ACC_D,ACC_E,200.00,2024-01-02 09:00:00
TXN_005,ACC_F,ACC_E,210.00,2024-01-02 09:30:00
TXN_006,ACC_G,ACC_E,195.00,2024-01-02 10:00:00
TXN_007,ACC_H,ACC_E,185.00,2024-01-02 10:30:00
TXN_008,ACC_I,ACC_E,220.00,2024-01-02 11:00:00
TXN_009,ACC_J,ACC_E,205.00,2024-01-02 11:30:00
TXN_010,ACC_K,ACC_E,215.00,2024-01-02 12:00:00
TXN_011,ACC_L,ACC_E,190.00,2024-01-02 12:30:00
TXN_012,ACC_M,ACC_E,200.00,2024-01-02 13:00:00
TXN_013,ACC_N,ACC_E,180.00,2024-01-02 13:30:00
TXN_014,ACC_O,ACC_E,225.00,2024-01-02 14:00:00
TXN_015,ACC_E,ACC_P,1800.00,2024-01-03 08:00:00`

export default function FileUpload({ onResult, onLoading, onError, loading }) {
  const inputRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      onError('Please upload a valid CSV file.')
      return
    }
    onError(null)
    onLoading(true)
    onResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const apiBase = import.meta.env.VITE_API_URL || ''
      const { data } = await axios.post(`${apiBase}/analyze`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      })
      onResult(data)
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Analysis failed.'
      onError(msg)
    } finally {
      onLoading(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  const handleDragOver = (e) => e.preventDefault()

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sample_transactions.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="upload-section">
      <div
        className={`dropzone ${loading ? 'disabled' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => !loading && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files[0])}
        />
        <div className="dropzone-icon">📁</div>
        <p className="dropzone-main">
          {loading ? 'Analyzing…' : 'Drop your CSV file here or click to browse'}
        </p>
        <p className="dropzone-sub">
          Required columns: transaction_id, sender_id, receiver_id, amount, timestamp
        </p>
      </div>

      <div className="upload-actions">
        <div className="schema-hint">
          <strong>Expected format:</strong> YYYY-MM-DD HH:MM:SS for timestamps • amount as float
        </div>
        <button className="btn-sample" onClick={downloadSample}>
          ⬇ Download Sample CSV
        </button>
      </div>
    </div>
  )
}
