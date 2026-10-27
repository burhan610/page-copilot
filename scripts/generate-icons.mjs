#!/usr/bin/env node
/**
 * Generates the placeholder Page Copilot icons (16, 48, 128 px) without any
 * image dependencies. Draws a purple rounded tile with a white chat bubble
 * at 4x and downsamples for antialiasing.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const SCALE = 4

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBytes = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([length, typeBytes, data, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // no filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function insideTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function renderIcon(size) {
  const big = size * SCALE
  const pixels = new Float32Array(big * big * 4)

  const radius = big * 0.22
  const bubble = {
    left: big * 0.2,
    right: big * 0.8,
    top: big * 0.22,
    bottom: big * 0.64,
  }
  const bubbleRadius = big * 0.12
  const dotRadius = big * 0.045
  const dotY = big * 0.43

  for (let y = 0; y < big; y += 1) {
    const t = y / (big - 1)
    const bg = [mix(124, 67, t), mix(58, 56, t), mix(237, 202, t)]

    for (let x = 0; x < big; x += 1) {
      const i = (y * big + x) * 4

      if (!insideRoundedRect(x + 0.5, y + 0.5, 0, 0, big, big, radius)) {
        pixels[i + 3] = 0
        continue
      }

      let color = bg
      const inBubble =
        insideRoundedRect(
          x + 0.5,
          y + 0.5,
          bubble.left,
          bubble.top,
          bubble.right,
          bubble.bottom,
          bubbleRadius,
        ) ||
        insideTriangle(
          x + 0.5,
          y + 0.5,
          big * 0.32,
          bubble.bottom - 1,
          big * 0.53,
          bubble.bottom - 1,
          big * 0.36,
          big * 0.8,
        )

      if (inBubble) {
        color = [255, 255, 255]
        for (const dotX of [0.36, 0.5, 0.64]) {
          const dx = x + 0.5 - big * dotX
          const dy = y + 0.5 - dotY
          if (dx * dx + dy * dy <= dotRadius * dotRadius) {
            color = [91, 33, 182]
          }
        }
      }

      pixels[i] = color[0]
      pixels[i + 1] = color[1]
      pixels[i + 2] = color[2]
      pixels[i + 3] = 255
    }
  }

  // Box downsample.
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const i = ((y * SCALE + sy) * big + (x * SCALE + sx)) * 4
          const alpha = pixels[i + 3]
          r += pixels[i] * alpha
          g += pixels[i + 1] * alpha
          b += pixels[i + 2] * alpha
          a += alpha
        }
      }
      const o = (y * size + x) * 4
      if (a === 0) {
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 0
        out[o + 3] = 0
      } else {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
        out[o + 3] = Math.round(a / (SCALE * SCALE))
      }
    }
  }

  return encodePng(size, size, out)
}

for (const size of [16, 48, 128]) {
  const file = resolve(outDir, `icon${size}.png`)
  writeFileSync(file, renderIcon(size))
  console.log(`wrote ${file}`)
}
