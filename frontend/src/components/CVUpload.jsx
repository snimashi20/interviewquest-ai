import { useRef, useState } from 'react'
import { CV_ACCEPT } from '../data/interviewOptions'

// the "pick a file" control on the My CV tab. it only picks the file and hands it up -
// the parent page owns the upload itself, so it can refresh the checklist afterwards.
export default function CVUpload({ onFile, busy, label = 'Upload CV' }) {
  const inputRef = useRef(null)
  const [fileName, setFileName] = useState(null)

  const handleChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    onFile(file)
    // clear the input so picking the same file twice still fires a change event
    event.target.value = ''
  }

  return (
    <div className="field">
      <span>{label}</span>
      {/* the real file input is hidden because browsers style it inconsistently -
          the button below opens it instead */}
      <input
        ref={inputRef}
        type="file"
        accept={CV_ACCEPT}
        onChange={handleChange}
        disabled={busy}
        className="file-input-hidden"
      />
      <div className="upload-row">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Reading your CV…' : 'Choose file'}
        </button>
        <span className="muted">{fileName || 'PDF, DOCX, TXT or MD · max 5 MB'}</span>
      </div>
    </div>
  )
}
