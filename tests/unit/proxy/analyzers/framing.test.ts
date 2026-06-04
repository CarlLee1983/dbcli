// tests/unit/proxy/analyzers/framing.test.ts
import { describe, it, expect } from 'bun:test'
import { FrameBuffer } from '@/proxy/analyzers/types'

describe('FrameBuffer', () => {
  it('accumulates chunks and exposes a contiguous view', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([1, 2]))
    fb.push(new Uint8Array([3, 4, 5]))
    expect(fb.length).toBe(5)
    expect(Array.from(fb.peek(4))).toEqual([1, 2, 3, 4])
  })

  it('consume drops the first n bytes', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([1, 2, 3, 4]))
    fb.consume(2)
    expect(fb.length).toBe(2)
    expect(Array.from(fb.peek(2))).toEqual([3, 4])
  })

  it('readUInt24LE / readUInt32BE read at an offset', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([0x01, 0x00, 0x00, 0x99])) // 24-bit LE = 1
    expect(fb.readUInt24LE(0)).toBe(1)
    const fb2 = new FrameBuffer()
    fb2.push(new Uint8Array([0x00, 0x00, 0x00, 0x05])) // 32-bit BE = 5
    expect(fb2.readUInt32BE(0)).toBe(5)
  })
})
