// Small binary writer and reader for game messages (little endian).
// A writer is meant to be reused: call reset(), write, then take bytes().

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private bytesView: Uint8Array<ArrayBuffer>;
  private offset = 0;

  constructor(initialSize = 256) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
    this.bytesView = new Uint8Array(this.buffer);
  }

  reset(): this {
    this.offset = 0;
    return this;
  }

  get length(): number {
    return this.offset;
  }

  /** A view of the written bytes. It changes on the next write, copy it if you keep it. */
  bytes(): Uint8Array<ArrayBuffer> {
    return this.bytesView.subarray(0, this.offset);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.offset, v);
    this.offset += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.offset, v, true);
    this.offset += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
    return this;
  }

  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.offset, v, true);
    this.offset += 8;
    return this;
  }

  /** Short UTF-8 string, up to 65535 bytes, with a u16 length in front. */
  str(v: string): this {
    const encoded = TEXT_ENCODER.encode(v);
    if (encoded.length > 0xffff) throw new Error('String is too long for the protocol');
    this.u16(encoded.length);
    this.ensure(encoded.length);
    this.bytesView.set(encoded, this.offset);
    this.offset += encoded.length;
    return this;
  }

  private ensure(extra: number): void {
    const needed = this.offset + extra;
    if (needed <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength * 2;
    while (size < needed) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.bytesView.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
    this.bytesView = new Uint8Array(next);
  }
}

export class BinaryReader {
  private readonly view: DataView;
  private readonly bytesView: Uint8Array;
  private offset = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytesView = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytesView.buffer, this.bytesView.byteOffset, this.bytesView.byteLength);
  }

  get remaining(): number {
    return this.bytesView.byteLength - this.offset;
  }

  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  str(): string {
    const len = this.u16();
    this.need(len);
    const v = TEXT_DECODER.decode(this.bytesView.subarray(this.offset, this.offset + len));
    this.offset += len;
    return v;
  }

  private need(n: number): void {
    if (this.offset + n > this.bytesView.byteLength) throw new RangeError('Message is shorter than expected');
  }
}
