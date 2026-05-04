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

// ---------------------------------------------------------------------------
// Journal index (all_entries.txt)
// ---------------------------------------------------------------------------

export function parseJournalIndex(text: string): JournalIndexEntry[] {
  return text
    .split("\n")
    .map((line) => {
      const m = line.trim().match(/^(.+?)\s+\+\s+(.+?)\s+=\s+(.+?)\s+\((\d+)\)$/);
      if (!m) return null;
      return { animalA: m[1], animalB: m[2], hybridName: m[3], saveId: parseInt(m[4], 10) };
    })
    .filter((e): e is JournalIndexEntry => e !== null);
}

// ---------------------------------------------------------------------------
// Filesystem helpers (Deno)
// ---------------------------------------------------------------------------

export async function loadAllCreatures(dir: string): Promise<CreatureFile[]> {
  const files: CreatureFile[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const m = entry.name.match(/^creature_(\d+)\.bytes$/);
    if (!m) continue;
    const data = await Deno.readFile(`${dir}/${entry.name}`);
    files.push(new CreatureFile(data, parseInt(m[1], 10)));
  }
  return files.sort((a, b) => a.saveId - b.saveId);
}

export async function loadAllJournalFiles(dir: string): Promise<JournalFile[]> {
  const files: JournalFile[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const m = entry.name.match(/^(.+?)\s+\+\s+(.+?)\.bytes$/);
    if (!m) continue;
    const data = await Deno.readFile(`${dir}/${entry.name}`);
    files.push(new JournalFile(data, m[1], m[2]));
  }
  return files;
}

// ---------------------------------------------------------------------------
// CLI — deno run --allow-read --allow-write parser.ts <save-root> [out-dir]
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const root = Deno.args[0] ?? ".";
  const outDir = Deno.args[1];

  if (outDir) await Deno.mkdir(outDir, { recursive: true });

  const creatures = await loadAllCreatures(`${root}/SavedAnimals`);
  console.log(`Loaded ${creatures.length} creature(s):`);
  for (const c of creatures) {
    console.log(`  [${c.saveId}] ${c.stats["Name"] ?? "(unknown)"}`);
    if (outDir) {
      const base = `${outDir}/creature_${c.saveId}`;
      await Deno.writeTextFile(`${base}.json`, JSON.stringify(c.toJSON(), null, 2));
      await Deno.writeFile(`${base}.png`, c.imageBytes);
    }
  }

  const journalFiles = await loadAllJournalFiles(`${root}/Journal`);
  console.log(`\nJournal images: ${journalFiles.length}`);
  for (const j of journalFiles) {
    console.log(`  ${j.animalA} + ${j.animalB}  (${j.imageBytes.length} bytes)`);
    if (outDir) {
      const base = `${outDir}/${j.animalA} + ${j.animalB}`;
      await Deno.writeFile(`${base}.png`, j.imageBytes);
    }
  }

  const indexPath = `${root}/Journal/all_entries.txt`;
  try {
    const text = await Deno.readTextFile(indexPath);
    const entries = parseJournalIndex(text);
    console.log(`\nJournal index (${entries.length} entries):`);
    for (const e of entries) {
      console.log(`  ${e.animalA} + ${e.animalB} = ${e.hybridName} (saveId ${e.saveId})`);
    }
    if (outDir) {
      await Deno.writeTextFile(
        `${outDir}/journal_index.json`,
        JSON.stringify(entries, null, 2),
      );
    }
  } catch {
    console.log("\nNo journal index found.");
  }
}
