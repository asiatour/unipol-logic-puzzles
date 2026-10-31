import { createEdgeSpark } from "@edgespark/client";
import "@edgespark/client/styles.css";

const WORKER_URL = "https://staging--btnowg4yy54vl9fywzsv.youbase.cloud";

export const client = createEdgeSpark({ baseUrl: WORKER_URL });

/**
 * Fetch all puzzles from the server (public - no auth required)
 */
export async function fetchPuzzles() {
  const res = await client.api.fetch("/api/public/puzzles");
  if (!res.ok) {
    throw new Error(`Failed to fetch puzzles: ${res.status}`);
  }
  const data = await res.json();
  return data.data;
}

/**
 * Create a new puzzle on the server
 */
export async function createPuzzleOnServer(puzzle: {
  id: string;
  name: string;
  categories: unknown[];
  clues: unknown[];
  gridRows: number;
  solution: unknown[][];
  password?: string;
}) {
  const res = await client.api.fetch("/api/public/puzzles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(puzzle),
  });
  if (!res.ok) {
    throw new Error(`Failed to create puzzle: ${res.status}`);
  }
  const data = await res.json();
  return data.data;
}

/**
 * Update a puzzle on the server
 */
export async function updatePuzzleOnServer(
  puzzleId: string,
  updates: {
    name?: string;
    categories?: unknown[];
    clues?: unknown[];
    gridRows?: number;
    solution?: unknown[][];
    password?: string;
  }
) {
  const res = await client.api.fetch(`/api/public/puzzles/${puzzleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    throw new Error(`Failed to update puzzle: ${res.status}`);
  }
  const data = await res.json();
  return data.data;
}

/**
 * Delete a puzzle from the server
 */
export async function deletePuzzleOnServer(puzzleId: string) {
  const res = await client.api.fetch(`/api/public/puzzles/${puzzleId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete puzzle: ${res.status}`);
  }
  const data = await res.json();
  return data.data;
}

/**
 * Update puzzle order on the server
 */
export async function updatePuzzleOrder(puzzleIds: string[]) {
  const res = await client.api.fetch("/api/public/puzzles-order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ puzzleIds }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update puzzle order: ${res.status}`);
  }
  const data = await res.json();
  return data.data;
}

/**
 * Render auth UI into a container element
 */
export async function renderAuthUI(
  container: HTMLElement,
  options?: {
    redirectTo?: string;
    labels?: Record<string, string>;
  }
) {
  await client.auth.renderAuthUI(container, {
    redirectTo: options?.redirectTo || "/",
    labels: options?.labels,
  });
}

/**
 * Sign out the current user
 */
export async function signOut() {
  await client.auth.signOut();
}
