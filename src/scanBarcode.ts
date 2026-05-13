import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
import type { Result } from '@zxing/library'
import { highlightFromBarcodeInCrop, type Highlight } from './detect'

const hints = new Map<DecodeHintType, unknown>()
hints.set(DecodeHintType.TRY_HARDER, true)

const reader = new BrowserMultiFormatReader(hints)

function clampCrop(
  nw: number,
  nh: number,
  crop: { sx: number; sy: number; sw: number; sh: number },
): { sx: number; sy: number; sw: number; sh: number } | null {
  const sx = Math.max(0, Math.floor(crop.sx))
  const sy = Math.max(0, Math.floor(crop.sy))
  const sw = Math.min(nw - sx, Math.max(1, Math.floor(crop.sw)))
  const sh = Math.min(nh - sy, Math.max(1, Math.floor(crop.sh)))
  if (sw < 48 || sh < 48) return null
  return { sx, sy, sw, sh }
}

/** Full image scaled so max edge = targetMaxEdge (up or down). */
function drawScaledFull(
  img: HTMLImageElement,
  targetMaxEdge: number,
): { canvas: HTMLCanvasElement; crop: { sx: number; sy: number; sw: number; sh: number }; cw: number; ch: number } {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const r = targetMaxEdge / Math.max(nw, nh)
  const cw = Math.max(1, Math.round(nw * r))
  const ch = Math.max(1, Math.round(nh * r))
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(cw, 4096)
  canvas.height = Math.min(ch, 4096)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, nw, nh, 0, 0, canvas.width, canvas.height)
  return {
    canvas,
    crop: { sx: 0, sy: 0, sw: nw, sh: nh },
    cw: canvas.width,
    ch: canvas.height,
  }
}

/** Draw source crop into canvas, enlarged so the shorter side is at least minCanvasEdge. */
function drawCropUpscaled(
  img: HTMLImageElement,
  crop: { sx: number; sy: number; sw: number; sh: number },
  minCanvasEdge: number,
  grayscale: boolean,
): { canvas: HTMLCanvasElement; cw: number; ch: number } {
  const { sx, sy, sw, sh } = crop
  const scale = Math.max(minCanvasEdge / Math.min(sw, sh), 1)
  let cw = Math.round(sw * scale)
  let ch = Math.round(sh * scale)
  cw = Math.min(Math.max(cw, minCanvasEdge), 4096)
  ch = Math.min(Math.max(ch, minCanvasEdge), 4096)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (grayscale) {
    ctx.filter = 'grayscale(1) contrast(1.12)'
  }
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, cw, ch)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch)
  ctx.filter = 'none'
  return { canvas, cw, ch }
}

async function tryDecodeCanvas(canvas: HTMLCanvasElement): Promise<Result | null> {
  try {
    return await reader.decodeFromCanvas(canvas)
  } catch {
    return null
  }
}

/** Same QR often decodes from overlapping crops — keep one per payload string. */
function dedupeBarcodes(list: Highlight[]): Highlight[] {
  const out: Highlight[] = []
  for (const h of list) {
    const text = h.text.trim()
    if (!text) continue
    if (out.some((o) => o.text.trim() === text)) continue
    out.push(h)
  }
  return out
}

function pushResult(
  bucket: Highlight[],
  result: Result,
  crop: { sx: number; sy: number; sw: number; sh: number },
  cw: number,
  ch: number,
): void {
  bucket.push(highlightFromBarcodeInCrop(result, crop, cw, ch))
}

/**
 * Run every decode path (full frame, scales, bottom/side crops) and collect **all** distinct
 * barcodes/QR codes—typical flyers have two or more codes in the lower half.
 */
export async function scanAllBarcodesBestEffort(img: HTMLImageElement): Promise<Highlight[]> {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const raw: Highlight[] = []

  try {
    const r = await reader.decodeFromImageElement(img)
    pushResult(raw, r, { sx: 0, sy: 0, sw: nw, sh: nh }, nw, nh)
  } catch {
    /* continue */
  }

  const maxEdges = [2048, 1600, 1280, 1024, 900, 768, 640, 512]
  for (const me of maxEdges) {
    const { canvas, crop, cw, ch } = drawScaledFull(img, me)
    if (cw === nw && ch === nh && me >= Math.max(nw, nh)) continue
    const r = await tryDecodeCanvas(canvas)
    if (r) pushResult(raw, r, crop, cw, ch)
  }

  const cropDefs: { sx: number; sy: number; sw: number; sh: number }[] = [
    { sx: 0, sy: nh * 0.5, sw: nw * 0.62, sh: nh * 0.5 },
    { sx: 0, sy: nh * 0.55, sw: nw * 0.5, sh: nh * 0.45 },
    { sx: nw * 0.5, sy: nh * 0.55, sw: nw * 0.5, sh: nh * 0.45 },
    { sx: 0, sy: nh * 0.58, sw: nw * 0.55, sh: nh * 0.42 },
    { sx: 0, sy: nh * 0.6, sw: nw * 0.5, sh: nh * 0.4 },
    { sx: nw * 0.2, sy: nh * 0.55, sw: nw * 0.8, sh: nh * 0.45 },
    { sx: nw * 0.4, sy: nh * 0.52, sw: nw * 0.6, sh: nh * 0.48 },
    { sx: nw * 0.25, sy: nh * 0.58, sw: nw * 0.5, sh: nh * 0.4 },
    { sx: nw * 0.45, sy: nh * 0.58, sw: nw * 0.52, sh: nh * 0.4 },
  ]

  for (const c of cropDefs) {
    const crop = clampCrop(nw, nh, c)
    if (!crop) continue
    for (const minEdge of [360, 480, 640]) {
      for (const gray of [false, true]) {
        const { canvas, cw, ch } = drawCropUpscaled(img, crop, minEdge, gray)
        const r = await tryDecodeCanvas(canvas)
        if (r) pushResult(raw, r, crop, cw, ch)
      }
    }
  }

  return dedupeBarcodes(raw)
}
