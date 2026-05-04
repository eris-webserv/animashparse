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
 *   [Byte]    n  (random padding length, 3–14)
 *   [n bytes] random garbage
 *   [rest]    raw PNG
 *
 * Journal/all_entries.txt — plain text index:
 *   <index>\t<animalA> + <animalB> = <hybridName> (<saveId>)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatureSave {
  saveId: number;
  stats: Record<string, string>;
  imageBytes: Uint8Array;
}

export interface JournalImage {
  animalA: string;
  animalB: string;
  imageBytes: Uint8Array; // raw PNG
}

export interface JournalEntry {
  index: number;
  animalA: string;
  animalB: string;
  hybridName: string;
  saveId: number;
}

// ---------------------------------------------------------------------------
// PacketReader — mirrors the game's Packet class (little-endian, UTF-16LE)
// ---------------------------------------------------------------------------

class PacketReader {
  private view: DataView;
  private pos = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  getByte(): number {
    return this.view.getUint8(this.pos++);
  }

  getShort(): number {
    const v = this.view.getInt16(this.pos, /*littleEndian=*/ true);
    this.pos += 2;
    return v;
  }

  getLong(): number {
    const v = this.view.getInt32(this.pos, /*littleEndian=*/ true);
    this.pos += 4;
    return v;
  }

  getString(): string {
    const byteLen = this.getShort();
    const slice = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.pos,
      byteLen,
    );
    this.pos += byteLen;
    return new TextDecoder("utf-16le").decode(slice);
  }

  getBytes(count: number): Uint8Array {
    const slice = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.pos,
      count,
    );
    this.pos += count;
    return slice;
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseCreature(data: Uint8Array, saveId: number): CreatureSave {
  const p = new PacketReader(data);

  const stringCount = p.getShort();
  const stats: Record<string, string> = {};

  let pendingKey: string | null = null;
  for (let i = 0; i < stringCount; i++) {
    const s = p.getString();
    if (pendingKey === null) {
      pendingKey = s;
    } else {
      stats[pendingKey] = s;
      pendingKey = null;
    }
  }

  const imageLen = p.getLong();
  const imageBytes = p.getBytes(imageLen);

  return { saveId, stats, imageBytes };
}

export function parseJournalImage(
  data: Uint8Array,
  animalA: string,
  animalB: string,
): JournalImage {
  const skipCount = data[0];
  const imageBytes = data.slice(1 + skipCount);
  return { animalA, animalB, imageBytes };
}

/** Parse a single line from all_entries.txt. Returns null on malformed lines. */
export function parseJournalEntryLine(line: string): JournalEntry | null {
  const m = line.match(/^(\d+)\s+(.+?)\s+\+\s+(.+?)\s+=\s+(.+?)\s+\((\d+)\)$/);
  if (!m) return null;
  return {
    index: parseInt(m[1], 10),
    animalA: m[2],
    animalB: m[3],
    hybridName: m[4],
    saveId: parseInt(m[5], 10),
  };
}

export function parseJournalIndex(text: string): JournalEntry[] {
  return text
    .split("\n")
    .map((l) => parseJournalEntryLine(l.trim()))
    .filter((e): e is JournalEntry => e !== null);
}

// ---------------------------------------------------------------------------
// Filesystem helpers (Deno)
// ---------------------------------------------------------------------------

/** Load all creatures from a SavedAnimals directory. */
export async function loadAllCreatures(
  dir: string,
): Promise<CreatureSave[]> {
  const saves: CreatureSave[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const m = entry.name.match(/^creature_(\d+)\.bytes$/);
    if (!m) continue;
    const saveId = parseInt(m[1], 10);
    const data = await Deno.readFile(`${dir}/${entry.name}`);
    saves.push(parseCreature(data, saveId));
  }
  return saves.sort((a, b) => a.saveId - b.saveId);
}

/** Load all journal images from a Journal directory. */
export async function loadAllJournalImages(
  dir: string,
): Promise<JournalImage[]> {
  const images: JournalImage[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const m = entry.name.match(/^(.+?)\s+\+\s+(.+?)\.bytes$/);
    if (!m) continue;
    const data = await Deno.readFile(`${dir}/${entry.name}`);
    images.push(parseJournalImage(data, m[1], m[2]));
  }
  return images;
}

// ---------------------------------------------------------------------------
// CLI demo — deno run --allow-read parser.ts <save-root>
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const root = Deno.args[0] ?? ".";

  const creatures = await loadAllCreatures(`${root}/SavedAnimals`);
  console.log(`Loaded ${creatures.length} creature(s):`);
  for (const c of creatures) {
    const name = c.stats["Name"] ?? "(unknown)";
    console.log(`  [${c.saveId}] ${name}  (${c.imageBytes.length} image bytes)`);
    for (const [k, v] of Object.entries(c.stats)) {
      if (k === "Name") continue;
      const preview = v.length > 60 ? v.slice(0, 57) + "…" : v;
      console.log(`       ${k}: ${preview}`);
    }
  }

  const indexPath = `${root}/Journal/all_entries.txt`;
  try {
    const text = await Deno.readTextFile(indexPath);
    const entries = parseJournalIndex(text);
    console.log(`\nJournal index (${entries.length} entries):`);
    for (const e of entries) {
      console.log(`  [${e.index}] ${e.animalA} + ${e.animalB} = ${e.hybridName} (saveId ${e.saveId})`);
    }
  } catch {
    console.log("\nNo journal index found.");
  }

  const journalImages = await loadAllJournalImages(`${root}/Journal`);
  console.log(`\nJournal images: ${journalImages.length}`);
  for (const img of journalImages) {
    console.log(`  ${img.animalA} + ${img.animalB}  (${img.imageBytes.length} PNG bytes)`);
  }
}
