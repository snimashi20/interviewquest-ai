import { useLayoutEffect, useRef } from 'react'

const INDENT = '    ' // four spaces, the same either language reads comfortably

// a plain typable code editor: a textarea with a line-number gutter beside it.
// deliberately dependency-free - it gives the three things a textarea alone gets wrong
// (Tab indents instead of leaving the box, Enter keeps your indentation, and you can see
// which line you are on) without pulling a whole editor library into the project.
export default function CodeEditor({ value, onChange, language, readOnly = false }) {
  const textareaRef = useRef(null)
  const guttersRef = useRef(null)

  const lineCount = value.split('\n').length

  // keep the gutter lined up with the text while scrolling
  const syncScroll = () => {
    if (guttersRef.current && textareaRef.current) {
      guttersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  // after an edit that moves the caret itself (Tab, Enter), put it back where we want it
  const pendingCaret = useRef(null)
  useLayoutEffect(() => {
    if (pendingCaret.current != null && textareaRef.current) {
      textareaRef.current.selectionStart = pendingCaret.current
      textareaRef.current.selectionEnd = pendingCaret.current
      pendingCaret.current = null
    }
  })

  const handleKeyDown = (event) => {
    if (readOnly) return
    const textarea = event.target
    const { selectionStart, selectionEnd } = textarea

    // Tab indents instead of jumping to the next control
    if (event.key === 'Tab') {
      event.preventDefault()
      const next = value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd)
      pendingCaret.current = selectionStart + INDENT.length
      onChange(next)
      return
    }

    // Enter keeps the current line's indentation, and adds one level after a Python colon
    // or an opening brace
    if (event.key === 'Enter') {
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
      const currentLine = value.slice(lineStart, selectionStart)
      const indent = currentLine.match(/^[ \t]*/)[0]
      const opensBlock = /[:{[(]\s*$/.test(currentLine)
      const insert = `\n${indent}${opensBlock ? INDENT : ''}`

      event.preventDefault()
      const next = value.slice(0, selectionStart) + insert + value.slice(selectionEnd)
      pendingCaret.current = selectionStart + insert.length
      onChange(next)
    }
  }

  return (
    <div className="editor">
      {/* one line number per line, scrolled in step with the textarea */}
      <div className="editor-gutter" ref={guttersRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="editor-area"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        readOnly={readOnly}
        spellCheck="false"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={`${language} code editor`}
        placeholder={readOnly ? '' : 'Write your solution here…'}
      />
    </div>
  )
}
