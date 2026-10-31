import { Hono } from "hono";
import type { Client } from "@sdk/server-types";
import { tables, buckets } from "@generated";
import { eq, desc, asc } from "drizzle-orm";

export async function createApp(
  edgespark: Client<typeof tables>
): Promise<Hono> {
  const app = new Hono();

  // ═══════════════════════════════════════════════════════════
  // ALL PUZZLE ROUTES (public - no auth required)
  // ═══════════════════════════════════════════════════════════

  // Get all puzzles (ordered by sort_order)
  app.get("/api/public/puzzles", async (c) => {
    console.log("[API] GET /api/public/puzzles - fetching all puzzles");

    const results = await edgespark.db
      .select()
      .from(tables.puzzles)
      .orderBy(asc(tables.puzzles.sortOrder));

    const puzzles = results.map((row) => ({
      id: row.id,
      name: row.name,
      categories: JSON.parse(row.categories),
      clues: JSON.parse(row.clues),
      gridRows: row.gridRows,
      solution: JSON.parse(row.solution),
      password: row.password || undefined,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    console.log("[API] GET /api/public/puzzles - found", puzzles.length, "puzzles");
    return c.json({ data: puzzles });
  });

  // Get a specific puzzle by ID
  app.get("/api/public/puzzles/:id", async (c) => {
    const puzzleId = c.req.param("id");
    console.log("[API] GET /api/public/puzzles/:id - fetching puzzle:", puzzleId);

    const results = await edgespark.db
      .select()
      .from(tables.puzzles)
      .where(eq(tables.puzzles.id, puzzleId));

    if (results.length === 0) {
      return c.json({ error: "Puzzle not found" }, 404);
    }

    const row = results[0];
    const puzzle = {
      id: row.id,
      name: row.name,
      categories: JSON.parse(row.categories),
      clues: JSON.parse(row.clues),
      gridRows: row.gridRows,
      solution: JSON.parse(row.solution),
      password: row.password || undefined,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return c.json({ data: puzzle });
  });

  // Create a new puzzle
  app.post("/api/public/puzzles", async (c) => {
    const body = await c.req.json();
    console.log("[API] POST /api/public/puzzles - creating puzzle:", body.name);

    const maxOrderResult = await edgespark.db
      .select({ maxOrder: tables.puzzles.sortOrder })
      .from(tables.puzzles)
      .orderBy(desc(tables.puzzles.sortOrder))
      .limit(1);
    
    const nextOrder = maxOrderResult.length > 0 ? maxOrderResult[0].maxOrder + 1 : 0;

    const now = Date.now();
    const puzzleData = {
      id: body.id,
      userId: "public",
      name: body.name,
      categories: JSON.stringify(body.categories),
      clues: JSON.stringify(body.clues),
      gridRows: body.gridRows || 5,
      solution: JSON.stringify(body.solution),
      password: body.password || null,
      sortOrder: body.sortOrder ?? nextOrder,
      createdAt: now,
      updatedAt: now,
    };

    await edgespark.db.insert(tables.puzzles).values(puzzleData);

    console.log("[API] POST /api/public/puzzles - created puzzle:", puzzleData.id);
    return c.json({ data: { id: puzzleData.id } }, 201);
  });

  // Update a puzzle
  app.put("/api/public/puzzles/:id", async (c) => {
    const puzzleId = c.req.param("id");
    const body = await c.req.json();
    console.log("[API] PUT /api/public/puzzles/:id - updating puzzle:", puzzleId);

    const existing = await edgespark.db
      .select()
      .from(tables.puzzles)
      .where(eq(tables.puzzles.id, puzzleId));

    if (existing.length === 0) {
      return c.json({ error: "Puzzle not found" }, 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.categories !== undefined)
      updateData.categories = JSON.stringify(body.categories);
    if (body.clues !== undefined) updateData.clues = JSON.stringify(body.clues);
    if (body.gridRows !== undefined) updateData.gridRows = body.gridRows;
    if (body.solution !== undefined) updateData.solution = JSON.stringify(body.solution);
    if (body.password !== undefined) updateData.password = body.password || null;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;

    await edgespark.db
      .update(tables.puzzles)
      .set(updateData)
      .where(eq(tables.puzzles.id, puzzleId));

    console.log("[API] PUT /api/public/puzzles/:id - updated puzzle:", puzzleId);
    return c.json({ data: { success: true } });
  });

  // Update puzzle order
  app.put("/api/public/puzzles-order", async (c) => {
    const body = await c.req.json();
    const { puzzleIds } = body;
    console.log("[API] PUT /api/public/puzzles-order - updating order for", puzzleIds.length, "puzzles");

    for (let i = 0; i < puzzleIds.length; i++) {
      const puzzleId = puzzleIds[i];
      
      const existing = await edgespark.db
        .select()
        .from(tables.puzzles)
        .where(eq(tables.puzzles.id, puzzleId));

      if (existing.length > 0) {
        await edgespark.db
          .update(tables.puzzles)
          .set({ sortOrder: i, updatedAt: Date.now() })
          .where(eq(tables.puzzles.id, puzzleId));
      }
    }

    console.log("[API] PUT /api/public/puzzles-order - order updated");
    return c.json({ data: { success: true } });
  });

  // Delete a puzzle
  app.delete("/api/public/puzzles/:id", async (c) => {
    const puzzleId = c.req.param("id");
    console.log("[API] DELETE /api/public/puzzles/:id - deleting puzzle:", puzzleId);

    const existing = await edgespark.db
      .select()
      .from(tables.puzzles)
      .where(eq(tables.puzzles.id, puzzleId));

    if (existing.length === 0) {
      return c.json({ error: "Puzzle not found" }, 404);
    }

    await edgespark.db
      .delete(tables.puzzles)
      .where(eq(tables.puzzles.id, puzzleId));

    console.log("[API] DELETE /api/public/puzzles/:id - deleted puzzle:", puzzleId);
    return c.json({ data: { success: true } });
  });

  return app;
}
