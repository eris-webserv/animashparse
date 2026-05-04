import { assertEquals } from "jsr:@std/assert";
import { CreatureFile, JournalFile } from "./parser.ts";

const SAVE_DIR = "testFiles/SavedAnimals";
const JOURNAL_DIR = "testFiles/Journal";

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: length mismatch — got ${actual.length}, expected ${expected.length}`);
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${label}: byte mismatch at offset 0x${i.toString(16)} — got 0x${actual[i].toString(16)}, expected 0x${expected[i].toString(16)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function allCreatureFiles(): Promise<{ name: string; saveId: number }[]> {
  const results: { name: string; saveId: number }[] = [];
  for await (const entry of Deno.readDir(SAVE_DIR)) {
    const m = entry.name.match(/^creature_(\d+)\.bytes$/);
    if (m) results.push({ name: entry.name, saveId: parseInt(m[1], 10) });
  }
  return results.sort((a, b) => a.saveId - b.saveId);
}

async function allJournalImageFiles(): Promise<{ name: string; animalA: string; animalB: string }[]> {
  const results: { name: string; animalA: string; animalB: string }[] = [];
  for await (const entry of Deno.readDir(JOURNAL_DIR)) {
    const m = entry.name.match(/^(.+?)\s+\+\s+(.+?)\.bytes$/);
    if (m) results.push({ name: entry.name, animalA: m[1], animalB: m[2] });
  }
  return results;
}

// ---------------------------------------------------------------------------
// CreatureFile
// ---------------------------------------------------------------------------

Deno.test("CreatureFile: fromBytes → toBytes bytematches original (all files)", async () => {
  for (const { name, saveId } of await allCreatureFiles()) {
    const original = await Deno.readFile(`${SAVE_DIR}/${name}`);
    const creature = new CreatureFile(original, saveId);
    assertBytesEqual(new Uint8Array(creature.toBytes()), new Uint8Array(original), name);
  }
});

Deno.test("CreatureFile: JSON round-trip preserves stats and saveId (all files)", async () => {
  for (const { name, saveId } of await allCreatureFiles()) {
    const original = await Deno.readFile(`${SAVE_DIR}/${name}`);
    const creature = new CreatureFile(original, saveId);
    const json = creature.toJSON();

    const restored = new CreatureFile();
    restored.fromJSON(json);

    assertEquals(restored.toJSON(), json, `JSON mismatch on ${name}`);
  }
});

// ---------------------------------------------------------------------------
// JournalFile
// ---------------------------------------------------------------------------

// toBytes() regenerates random padding values, so we can't byte-match the
// original. What we verify: the image survives a full re-encode → decode
// round-trip (byte[0] is the stored skip count; the padding bytes are junk).
Deno.test("JournalFile: image survives toBytes → fromBytes round-trip (all files)", async () => {
  for (const { name, animalA, animalB } of await allJournalImageFiles()) {
    const original = await Deno.readFile(`${JOURNAL_DIR}/${name}`);
    const journal = new JournalFile(original, animalA, animalB);

    const reEncoded = journal.toBytes();
    const restored = new JournalFile(reEncoded, animalA, animalB);

    assertBytesEqual(new Uint8Array(restored.imageBytes), new Uint8Array(journal.imageBytes), name);
  }
});

Deno.test("JournalFile: JSON round-trip preserves animal names (all files)", async () => {
  for (const { name, animalA, animalB } of await allJournalImageFiles()) {
    const original = await Deno.readFile(`${JOURNAL_DIR}/${name}`);
    const journal = new JournalFile(original, animalA, animalB);

    assertEquals(
      journal.toJSON(),
      { animalA, animalB },
      `name mismatch on ${name}`,
    );
  }
});
