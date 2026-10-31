import type { Puzzle } from '../types/puzzle';
import seedPuzzles from '../data/puzzles.json';

/**
 * Static build data source.
 *
 * The app used to load puzzles from an EdgeSpark backend (`/api/public/puzzles`)
 * and push designer edits back to it. This build is hosted as a plain static
 * site (GitHub Pages), so the puzzles are bundled at build time from
 * `src/data/puzzles.json` and all mutations are local only: the zustand store
 * persists whatever the player/designer changes in localStorage.
 */

const SEED_PUZZLES = seedPuzzles as unknown as Puzzle[];

/** Deep clone so callers can never mutate the bundled module data. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Return the bundled puzzles. Kept async so callers are unchanged.
 */
export async function fetchPuzzles(): Promise<Puzzle[]> {
  return clone(SEED_PUZZLES);
}

/*
 * The functions below used to write to the backend. With no server in a static
 * build they resolve locally and the store's localStorage persistence is the
 * source of truth for any edits made in the designer.
 */

export async function createPuzzleOnServer(puzzle: Puzzle): Promise<Puzzle> {
  return puzzle;
}

export async function updatePuzzleOnServer(
  _puzzleId: string,
  updates: Partial<Puzzle>
): Promise<Partial<Puzzle>> {
  return updates;
}

export async function deletePuzzleOnServer(_puzzleId: string): Promise<null> {
  return null;
}

export async function updatePuzzleOrder(puzzleIds: string[]): Promise<string[]> {
  return puzzleIds;
}
