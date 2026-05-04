/**
 * Save file parser for Animash.
 *
 * SavedAnimals/creature_N.bytes — Packet binary format:
 *   [Int16LE]  string count N  (= 2 × number of stats key-value pairs)
 *   [N × String]  alternating key / value:
 *     [Int16LE]  byte length of UTF-16LE payload
 *     [bytes]    UTF-16LE payload
 *   [Int32LE]  image byte count M
 *   [M bytes]  raw image (PNG or JPEG)
 *
 * Journal/<animalA> + <animalB>.bytes — obfuscated mini-image:
 *   [Byte]    n  (random padding length, 3–14, from Unity Random.Range(3,15))
 *   [n bytes] random garbage
 *   [rest]    raw PNG
 *
 * Journal/all_entries.txt — plain text index:
 *   <animalA> + <animalB> = <hybridName> (<saveId>)
 */

import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Stats = Record<string, string>;

export type CreatureJSON = {
  saveId: number;
  stats: Stats;
};

export type JournalEntryJSON = {
  animalA: string;
  animalB: string;
};

export type JournalIndexEntry = {
  animalA: string;
  animalB: string;
  hybridName: string;
  saveId: number;
};

// ---------------------------------------------------------------------------
// PacketReader / PacketWriter — mirrors the game's Packet class
// ---------------------------------------------------------------------------

class PacketReader {
  private data: Buffer;
  private pos = 0;

  constructor(input: Buffer | Uint8Array) {
    this.data = Buffer.from(input);
  }

  getByte(): number {
    return this.data.readUInt8(this.pos++);
  }

  getShort(): number {
    const v = this.data.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  getLong(): number {
    const v = this.data.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  getString(): string {
    const len = this.getShort();
    const s = this.data.toString("utf16le", this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  getBytes(count: number): Buffer {
    const slice = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }
}

class PacketWriter {
  private chunks: Buffer[] = [];

  putByte(n: number): void {
    const b = Buffer.alloc(1);
    b.writeUInt8(n);
    this.chunks.push(b);
  }

  putShort(n: number): void {
    const b = Buffer.alloc(2);
    b.writeInt16LE(n);
    this.chunks.push(b);
  }

  putLong(n: number): void {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n);
    this.chunks.push(b);
  }

  putString(s: string): void {
    const raw = Buffer.from(s, "utf16le");
    const len = Buffer.alloc(2);
    len.writeInt16LE(raw.length);
    this.chunks.push(len, raw);
  }

  putBytes(bytes: Buffer | Uint8Array): void {
    this.chunks.push(Buffer.from(bytes));
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

// ---------------------------------------------------------------------------
// CreatureFile
// ---------------------------------------------------------------------------

export class CreatureFile {
  saveId: number = -1;
  stats: Stats = {};
  imageBytes: Buffer = Buffer.alloc(0);

  constructor(data?: Buffer | Uint8Array, saveId?: number) {
    if (data !== undefined) this.fromBytes(data, saveId ?? -1);
  }

  fromBytes(data: Buffer | Uint8Array, saveId: number = -1): void {
    this.saveId = saveId;
    const p = new PacketReader(data);

    const stringCount = p.getShort();
    this.stats = {};
    let pendingKey: string | null = null;
    for (let i = 0; i < stringCount; i++) {
      const s = p.getString();
      if (pendingKey === null) {
        pendingKey = s;
      } else {
        this.stats[pendingKey] = s;
        pendingKey = null;
      }
    }

    const imageLen = p.getLong();
    this.imageBytes = p.getBytes(imageLen);
  }

  toBytes(): Buffer {
    const w = new PacketWriter();
    const pairs = Object.entries(this.stats);
    w.putShort(pairs.length * 2);
    for (const [k, v] of pairs) {
      w.putString(k);
      w.putString(v);
    }
    w.putLong(this.imageBytes.length);
    w.putBytes(this.imageBytes);
    return w.toBuffer();
  }

  toJSON(): CreatureJSON {
    return { saveId: this.saveId, stats: this.stats };
  }

  fromJSON(data: CreatureJSON): void {
    this.saveId = data.saveId;
    this.stats = data.stats;
  }
}

// ---------------------------------------------------------------------------
// JournalFile
// ---------------------------------------------------------------------------

export class JournalFile {
  animalA: string = "";
  animalB: string = "";
  imageBytes: Buffer = Buffer.alloc(0);

  constructor(data?: Buffer | Uint8Array, animalA?: string, animalB?: string) {
    if (data !== undefined && animalA !== undefined && animalB !== undefined) {
      this.fromBytes(data, animalA, animalB);
    }
  }

  fromBytes(data: Buffer | Uint8Array, animalA: string, animalB: string): void {
    this.animalA = animalA;
    this.animalB = animalB;
    const buf = Buffer.from(data);
    const skipCount = buf.readUInt8(0);
    this.imageBytes = buf.subarray(1 + skipCount);
  }

  toBytes(): Buffer {
    // Reconstruct with a fresh random prefix matching the game's format.
    // Unity Random.Range(3, 15) is [3, 14] inclusive; Range(0, 250) is [0, 249].
    const n = Math.floor(Math.random() * 12) + 3;
    const prefix = Buffer.alloc(1 + n);
    prefix.writeUInt8(n, 0);
    for (let i = 1; i <= n; i++) {
      prefix.writeUInt8(Math.floor(Math.random() * 250), i);
    }
    return Buffer.concat([prefix, this.imageBytes]);
  }

  toJSON(): JournalEntryJSON {
    return { animalA: this.animalA, animalB: this.animalB };
  }
}

