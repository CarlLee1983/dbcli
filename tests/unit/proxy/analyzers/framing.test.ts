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

  it('readUInt24LE handles high-bit values', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([0xff, 0xff, 0xff]))
    expect(fb.readUInt24LE(0)).toBe(16777215)
    const fb2 = new FrameBuffer()
    fb2.push(new Uint8Array([0x00, 0x80, 0x00]))
    expect(fb2.readUInt24LE(0)).toBe(32768)
  })

  it('readUInt16LE reads little-endian', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([0x34, 0x12]))
    expect(fb.readUInt16LE(0)).toBe(0x1234)
  })

  it('readUInt32BE stays unsigned for high-bit values', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([0x80, 0x00, 0x00, 0x01]))
    expect(fb.readUInt32BE(0)).toBe(0x80000001)
  })

  it('reads past the end clamp to 0 instead of throwing', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([0x01, 0x02]))
    expect(fb.readUInt32BE(0)).toBe(0x01020000)
    expect(fb.byteAt(10)).toBeUndefined()
    expect(fb.readUInt24LE(10)).toBe(0)
  })

  it('text() UTF-8 decodes a slice', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array(new TextEncoder().encode('héllo')))
    expect(fb.text(0, fb.length)).toBe('héllo')
  })

  it('byteAt returns the byte or undefined out of range', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([0xaa, 0xbb]))
    expect(fb.byteAt(0)).toBe(0xaa)
    expect(fb.byteAt(1)).toBe(0xbb)
    expect(fb.byteAt(2)).toBeUndefined()
  })

  it('consume clamps when n exceeds length', () => {
    const fb = new FrameBuffer()
    fb.push(new Uint8Array([1, 2, 3]))
    fb.consume(10)
    expect(fb.length).toBe(0)
  })
})
