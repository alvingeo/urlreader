import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createWorker } from 'tesseract.js'
import { scanAllBarcodesBestEffort } from './scanBarcode'
import {
  flattenTesseractLines,
  highlightsFromOcrLines,
  normalizeUrlForOpen,
  type Highlight,
  type HighlightKind,
} from './detect'
import './App.css'

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
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const saved = localStorage.getItem('urlreader-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('urlreader-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#0f0e17' : '#fffaf7')
    }
  }, [theme])

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
    setStatus('Scanning barcodes / QR (multi-region) and reading text…')
    setError(null)
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!nw || !nh) {
      setError('Invalid image dimensions.')
      setStatus('')
      return
    }

    const found: Highlight[] = []

    const barcodes = await scanAllBarcodesBestEffort(img)
    found.push(...barcodes)

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
    <>
      <nav className="site-topbar" aria-label="Tiny Tool Town">
        <div className="site-topbar__links">
          <a
            className="site-topbar__brand"
            href="https://www.tinytooltown.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            🏘️ Tiny Tool Town
          </a>
          <a
            href="https://www.tinytooltown.com/tools/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Browse
          </a>
          <a
            href="https://www.tinytooltown.com/submit/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Submit
          </a>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </nav>
      <div className="app">
      <header className="header">
        <h1>Image link &amp; barcode reader</h1>
        <p className="intro-why">
          Flyers, posters, and screenshots are usually just <strong>pictures</strong>. You
          often cannot tap a URL inside a JPEG, and a small or blurry QR code may not scan
          reliably. This tool pulls those links and codes back out as real text you can{' '}
          <strong>copy</strong> or <strong>open</strong>.
        </p>
        <p className="lede">
          Paste, drop, or choose an image below. We highlight QR codes, barcodes, links,
          emails, phones, and common address-style lines—plus the full readable text.
        </p>
        <details className="explainer">
          <summary>How it works &amp; what technology this uses</summary>
          <div className="explainer-body">
            <h3 className="explainer-h">How it works</h3>
            <ol className="explainer-list">
              <li>Your image loads only in this tab (nothing is uploaded to our server).</li>
              <li>
                We scan for <strong>all</strong> barcodes and QR codes we can find using several
                zoom levels and bottom-of-image crops (common on flyers), then merge duplicate
                reads from overlapping regions.
              </li>
              <li>
                We run <strong>OCR</strong> (optical character recognition) with layout so
                we know where words sit on the page, then match URLs, emails, phone-like
                strings, and simple street-style lines.
              </li>
              <li>
                Highlights are drawn from those coordinates so you can click a region to
                open a link or copy text; the sidebar lists everything we found.
              </li>
            </ol>
            <h3 className="explainer-h">Technology</h3>
            <p className="explainer-p">
              <strong>React</strong> and <strong>TypeScript</strong>, built with{' '}
              <strong>Vite</strong>. Barcodes and QR codes use{' '}
              <a
                href="https://github.com/zxing-js/browser"
                target="_blank"
                rel="noopener noreferrer"
              >
                @zxing/browser
              </a>
              . Text and positions come from{' '}
              <a
                href="https://github.com/naptha/tesseract.js"
                target="_blank"
                rel="noopener noreferrer"
              >
                tesseract.js
              </a>{' '}
              (Tesseract OCR compiled to WebAssembly for the browser). The first OCR run may
              download a small English model. Quality depends on resolution, focus, and
              contrast—very fuzzy images will always be harder.
            </p>
          </div>
        </details>
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
        <p>
          All processing stays in your browser. We try every region pass to list distinct
          barcodes/QR codes; OCR may download a language pack on first use (~2–4 MB). Best results
          on sharp images.
          Styling is inspired by{' '}
          <a href="https://www.tinytooltown.com/" target="_blank" rel="noopener noreferrer">
            Tiny Tool Town
          </a>
          —free, fun, open-source tiny tools.
        </p>
      </footer>
    </div>
    </>
  )
}
