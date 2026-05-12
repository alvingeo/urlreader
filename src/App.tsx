import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { createWorker } from 'tesseract.js'
import {
  flattenTesseractLines,
  highlightFromBarcodeResult,
  highlightsFromOcrLines,
  normalizeUrlForOpen,
  type Highlight,
  type HighlightKind,
} from './detect'
import './App.css'

const reader = new BrowserMultiFormatReader()

const KIND_LABEL: Record<HighlightKind, string> = {
  url: 'Link',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  barcode: 'Barcode / QR',
}

let ocrWorkerPromise: ReturnType<typeof createWorker> | null = null

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng')
  }
  return ocrWorkerPromise
}

function loadImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please use an image file.'))
      return
    }
    const url = URL.createObjectURL(file)
    resolve(url)
  })
}

function bboxToStyle(
  h: Highlight,
  nw: number,
  nh: number,
): CSSProperties {
  const { x0, y0, x1, y1 } = h.bbox
  const left = Math.min(x0, x1)
  const top = Math.min(y0, y1)
  const w = Math.abs(x1 - x0)
  const he = Math.abs(y1 - y0)
  return {
    left: `${(left / nw) * 100}%`,
    top: `${(top / nh) * 100}%`,
    width: `${(w / nw) * 100}%`,
    height: `${(he / nh) * 100}%`,
  }
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

export default function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [fullText, setFullText] = useState('')
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 })
  const prevUrlRef = useRef<string | null>(null)

  const revokePrevious = useCallback((next: string | null) => {
    const prev = prevUrlRef.current
    if (prev && prev !== next && prev.startsWith('blob:')) {
      URL.revokeObjectURL(prev)
    }
    prevUrlRef.current = next
  }, [])

  const setFromFile = useCallback(
    async (file: File) => {
      setError(null)
      setHighlights([])
      setFullText('')
      setImgDims({ w: 0, h: 0 })
      try {
        const url = await loadImageFile(file)
        revokePrevious(url)
        setImageUrl(url)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load image.')
      }
    },
    [revokePrevious],
  )

  const processImage = useCallback(async (img: HTMLImageElement) => {
    setStatus('Scanning barcode and reading text…')
    setError(null)
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!nw || !nh) {
      setError('Invalid image dimensions.')
      setStatus('')
      return
    }

    const found: Highlight[] = []

    try {
      const result = await reader.decodeFromImageElement(img)
      found.push(highlightFromBarcodeResult(result))
    } catch {
      /* no barcode in image */
    }

    try {
      const worker = await getOcrWorker()
      const { data } = await worker.recognize(img, { rotateAuto: true }, { blocks: true })
      setFullText(data.text?.trim() ?? '')
      const lines = flattenTesseractLines(data.blocks)
      found.push(...highlightsFromOcrLines(lines))
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Text recognition failed. Try a clearer image.',
      )
    }

    setHighlights(found)
    setStatus('')
  }, [])

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      setImgDims({ w: img.naturalWidth, h: img.naturalHeight })
      void processImage(img)
    },
    [processImage],
  )

  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const items = ev.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          ev.preventDefault()
          const f = item.getAsFile()
          if (f) void setFromFile(f)
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [setFromFile])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer.files[0]
      if (f) void setFromFile(f)
    },
    [setFromFile],
  )

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (f) void setFromFile(f)
      e.target.value = ''
    },
    [setFromFile],
  )

  const onOpenLink = useCallback((h: Highlight) => {
    if (h.kind === 'url' || h.kind === 'email') {
      const target = normalizeUrlForOpen(h.text)
      window.open(target, '_blank', 'noopener,noreferrer')
    }
  }, [])

  const onCopyHighlight = useCallback(async (h: Highlight) => {
    await copyText(h.text)
    setCopiedId(h.id)
    window.setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const onCopyAll = useCallback(async () => {
    if (!fullText) return
    await copyText(fullText)
    setCopiedId('__all__')
    window.setTimeout(() => setCopiedId(null), 1500)
  }, [fullText])

  const clearImage = useCallback(() => {
    revokePrevious(null)
    setImageUrl(null)
    setHighlights([])
    setFullText('')
    setImgDims({ w: 0, h: 0 })
    setStatus('')
    setError(null)
  }, [revokePrevious])

  return (
    <div className="app">
      <header className="header">
        <h1>Image link &amp; barcode reader</h1>
        <p className="lede">
          Paste, drop, or choose an image. We highlight QR codes, barcodes, links,
          emails, phones, and common address lines so you can copy or open them.
        </p>
      </header>

      <section
        className={`dropzone ${imageUrl ? 'dropzone--compact' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {!imageUrl && (
          <div className="dropzone-inner">
            <p>
              <strong>Drop an image here</strong> or paste from the clipboard (
              <kbd>⌘V</kbd> / <kbd>Ctrl+V</kbd>)
            </p>
            <label className="file-btn">
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPickFile}
              />
              Choose file
            </label>
          </div>
        )}

        {imageUrl && (
          <div className="workspace">
            <div className="toolbar">
              <label className="file-btn file-btn--secondary">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={onPickFile}
                />
                New image
              </label>
              <button type="button" className="btn-ghost" onClick={clearImage}>
                Clear
              </button>
            </div>

            {status && <p className="status">{status}</p>}
            {error && <p className="err">{error}</p>}

            <div className="stage">
              <div className="frame">
                <img
                  src={imageUrl}
                  alt="Uploaded flyer or screenshot"
                  className="source-img"
                  onLoad={onImageLoad}
                />
                <div className="overlay" aria-hidden="true">
                  {imgDims.w > 0 &&
                    highlights.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="hotspot"
                        data-kind={h.kind}
                        style={bboxToStyle(h, imgDims.w, imgDims.h)}
                        title={`${KIND_LABEL[h.kind]}: ${h.text}`}
                        onClick={() => {
                          if (h.kind === 'url' || h.kind === 'email') {
                            onOpenLink(h)
                            return
                          }
                          if (
                            h.kind === 'barcode' &&
                            /^https?:\/\//i.test(h.text.trim())
                          ) {
                            window.open(
                              h.text.trim(),
                              '_blank',
                              'noopener,noreferrer',
                            )
                            return
                          }
                          void onCopyHighlight(h)
                        }}
                      />
                    ))}
                </div>
              </div>

              <aside className="sidebar">
                <h2>Detected ({highlights.length})</h2>
                {highlights.length === 0 && !status && (
                  <p className="muted">
                    No links or codes found. Try a sharper image or larger text.
                  </p>
                )}
                <ul className="hl-list">
                  {highlights.map((h) => (
                    <li key={h.id}>
                      <span className="tag" data-kind={h.kind}>
                        {KIND_LABEL[h.kind]}
                      </span>
                      <code className="hl-text">{h.text}</code>
                      <div className="hl-actions">
                        {(h.kind === 'url' || h.kind === 'email') && (
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => onOpenLink(h)}
                          >
                            Open
                          </button>
                        )}
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => void onCopyHighlight(h)}
                        >
                          {copiedId === h.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                {fullText && (
                  <div className="all-text">
                    <h2>All text</h2>
                    <textarea readOnly value={fullText} rows={8} className="ocr-text" />
                    <button type="button" className="file-btn" onClick={() => void onCopyAll()}>
                      {copiedId === '__all__' ? 'Copied' : 'Copy all text'}
                    </button>
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
      </section>

      <footer className="footer muted">
        Runs in your browser. First OCR pass may download a language model (~2–4 MB).
        Barcode scan finds one code per image; OCR quality depends on image clarity.
      </footer>
    </div>
  )
}
