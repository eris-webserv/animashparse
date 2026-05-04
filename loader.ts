/**
 * CLI loader for Animash save files.
 *
 * Usage:
 *   deno run --allow-read --allow-write loader.ts <file.bytes> [out-dir]
 *
 * Detects file type from the filename:
 *   creature_N.bytes        → CreatureFile  → out-dir/creature_N.json + creature_N.png
 *   <a> + <b>.bytes         → JournalFile   → out-dir/<a> + <b>.png
 *   all_entries.txt         → journal index → out-dir/journal_index.json
 */

import * as path from "node:path";
import { CreatureFile, JournalFile, type JournalIndexEntry } from "./parser.ts";

function parseJournalIndex(text: string): JournalIndexEntry[] {
  return text
    .split("\n")
    .map((line) => {
      const m = line.trim().match(/^(.+?)\s+\+\s+(.+?)\s+=\s+(.+?)\s+\((\d+)\)$/);
      if (!m) return null;
      return { animalA: m[1], animalB: m[2], hybridName: m[3], saveId: parseInt(m[4], 10) };
    })
    .filter((e): e is JournalIndexEntry => e !== null);
}

async function loadCreature(filePath: string): Promise<CreatureFile> {
  const name = path.basename(filePath);
  const m = name.match(/^creature_(\d+)\.bytes$/);
  if (!m) throw new Error(`Not a creature file: ${name}`);
  const data = await Deno.readFile(filePath);
  return new CreatureFile(data, parseInt(m[1], 10));
}

async function loadJournal(filePath: string): Promise<JournalFile> {
  const name = path.basename(filePath, ".bytes");
  const m = name.match(/^(.+?)\s+\+\s+(.+?)$/);
  if (!m) throw new Error(`Cannot parse animal names from filename: ${path.basename(filePath)}`);
  const data = await Deno.readFile(filePath);
  return new JournalFile(data, m[1], m[2]);
}

async function loadJournalIndex(filePath: string) {
  const text = await Deno.readTextFile(filePath);
  return parseJournalIndex(text);
}

if (import.meta.main) {
  const filePath = Deno.args[0];
  const outDir = Deno.args[1];

  if (!filePath) {
    console.error("Usage: loader.ts <file.bytes|all_entries.txt> [out-dir]");
    Deno.exit(1);
  }

  if (outDir) await Deno.mkdir(outDir, { recursive: true });

  const name = path.basename(filePath);

  if (name === "all_entries.txt") {
    const entries = await loadJournalIndex(filePath);
    console.log(`Journal index (${entries.length} entries):`);
    for (const e of entries) {
      console.log(`  ${e.animalA} + ${e.animalB} = ${e.hybridName} (saveId ${e.saveId})`);
    }
    if (outDir) {
      const out = path.join(outDir, "journal_index.json");
      await Deno.writeTextFile(out, JSON.stringify(entries, null, 2));
      console.log(`  → ${out}`);
    }
  } else if (/^creature_\d+\.bytes$/.test(name)) {
    const creature = await loadCreature(filePath);
    const stem = `creature_${creature.saveId}`;
    console.log(`[${creature.saveId}] ${creature.stats["Name"] ?? "(unknown)"}`);
    for (const [k, v] of Object.entries(creature.stats)) {
      console.log(`  ${k}: ${v}`);
    }
    if (outDir) {
      const jsonOut = path.join(outDir, `${stem}.json`);
      const pngOut = path.join(outDir, `${stem}.png`);
      await Deno.writeTextFile(jsonOut, JSON.stringify(creature.toJSON(), null, 2));
      await Deno.writeFile(pngOut, creature.imageBytes);
      console.log(`  → ${jsonOut}`);
      console.log(`  → ${pngOut}`);
    }
  } else if (name.endsWith(".bytes")) {
    const journal = await loadJournal(filePath);
    console.log(`${journal.animalA} + ${journal.animalB}  (${journal.imageBytes.length} bytes)`);
    if (outDir) {
      const pngOut = path.join(outDir, `${journal.animalA} + ${journal.animalB}.png`);
      await Deno.writeFile(pngOut, journal.imageBytes);
      console.log(`  → ${pngOut}`);
    }
  } else {
    console.error(`Unrecognised file: ${name}`);
    Deno.exit(1);
  }
}
