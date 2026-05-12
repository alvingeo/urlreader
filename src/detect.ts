import type { Result } from '@zxing/library'

export type HighlightKind =
  | 'url'
  | 'email'
  | 'phone'
  | 'address'
  | 'barcode'

export interface Highlight {
  id: string
  kind: HighlightKind
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface Bbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface WordLike {
  text: string
  bbox: Bbox
}

interface LineLike {
  text: string
  words: WordLike[]
  bbox: Bbox
}

/** https://, www., or bare domains with a path or common TLD */
const URL_RE =
  /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})(?:\/[^\s<>"']*)?/g

const EMAIL_RE =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

const PHONE_RE =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3}[-.\s]?\d{3,4}\b/g

/** Street-style lines (best-effort; many valid addresses won't match) */
const ADDRESS_HINT_RE =
  /\b\d{1,6}\s+.{3,80}\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b/i

function newId(): string {
  return crypto.randomUUID()
}

function mergeBbox(boxes: Bbox[]): Bbox {
  const xs0 = boxes.map((b) => b.x0)
  const ys0 = boxes.map((b) => b.y0)
  const xs1 = boxes.map((b) => b.x1)
  const ys1 = boxes.map((b) => b.y1)
  return {
    x0: Math.min(...xs0),
    y0: Math.min(...ys0),
    x1: Math.max(...xs1),
    y1: Math.max(...ys1),
  }
}

/** Map [start, end) in space-joined word text to bbox from ordered words. */
function rangeToBbox(words: WordLike[], start: number, end: number): Bbox | null {
  if (start >= end || words.length === 0) return null
  let pos = 0
  const overlapping: WordLike[] = []
  for (const w of words) {
    if (pos > 0) pos += 1
    const ws = pos
    const we = pos + w.text.length
    if (we > start && ws < end) overlapping.push(w)
    pos = we
  }
  if (overlapping.length === 0) return null
  return mergeBbox(overlapping.map((w) => w.bbox))
}

function lineBuiltText(words: WordLike[]): string {
  return words.map((w) => w.text).join(' ')
}

function pushMatches(
  out: Highlight[],
  line: LineLike,
  re: RegExp,
  kind: HighlightKind,
  built: string,
): void {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(built)) !== null) {
    const text = m[0].trim()
    if (!text) continue
    const box = rangeToBbox(line.words, m.index, m.index + m[0].length)
    const bbox = box ?? line.bbox
    out.push({ id: newId(), kind, text, bbox })
  }
}

export function highlightsFromOcrLines(lines: LineLike[]): Highlight[] {
  const out: Highlight[] = []
  for (const line of lines) {
    const words = line.words ?? []
    const built = words.length ? lineBuiltText(words) : line.text
    pushMatches(out, line, URL_RE, 'url', built)
    pushMatches(out, line, EMAIL_RE, 'email', built)
    pushMatches(out, line, PHONE_RE, 'phone', built)
    ADDRESS_HINT_RE.lastIndex = 0
    if (ADDRESS_HINT_RE.test(line.text)) {
      const box = words.length ? mergeBbox(words.map((w) => w.bbox)) : line.bbox
      out.push({ id: newId(), kind: 'address', text: line.text.trim(), bbox: box })
    }
  }
  return dedupeOverlapping(out)
}

/** Drop duplicate regions with same text (Tesseract sometimes duplicates lines). */
function dedupeOverlapping(highlights: Highlight[]): Highlight[] {
  const seen = new Set<string>()
  const result: Highlight[] = []
  for (const h of highlights) {
    const key = `${h.kind}:${h.text}:${Math.round(h.bbox.x0)}:${Math.round(h.bbox.y0)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(h)
  }
  return result
}

export function flattenTesseractLines(blocks: unknown): LineLike[] {
  const lines: LineLike[] = []
  if (!Array.isArray(blocks)) return lines
  for (const block of blocks) {
    const b = block as { paragraphs?: { lines?: LineLike[] }[] }
    for (const para of b.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        lines.push(line)
      }
    }
  }
  return lines
}

export function highlightFromBarcodeResult(result: Result): Highlight {
  const pts = result.getResultPoints()
  let bbox: Bbox
  if (pts.length >= 2) {
    const xs = pts.map((p) => p.getX())
    const ys = pts.map((p) => p.getY())
    const pad = 4
    bbox = {
      x0: Math.min(...xs) - pad,
      y0: Math.min(...ys) - pad,
      x1: Math.max(...xs) + pad,
      y1: Math.max(...ys) + pad,
    }
  } else {
    bbox = { x0: 0, y0: 0, x1: 0, y1: 0 }
  }
  return {
    id: newId(),
    kind: 'barcode',
    text: result.getText(),
    bbox,
  }
}

export function normalizeUrlForOpen(raw: string): string {
  const t = raw.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (/^www\./i.test(t)) return `https://${t}`
  if (EMAIL_RE.test(t)) return `mailto:${t}`
  return t
}
