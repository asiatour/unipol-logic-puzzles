import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Puzzle, Clue, Category, AppScreen, ViewMode } from '../types/puzzle';
import {
  fetchPuzzles,
  createPuzzleOnServer,
  updatePuzzleOnServer,
  deletePuzzleOnServer,
  updatePuzzleOrder,
} from '../api/client';

const generateId = () => Math.random().toString(36).substring(2, 10);

interface PuzzleState {
  puzzles: Puzzle[];
  currentPuzzleId: string | null;
  currentScreen: AppScreen;
  viewMode: ViewMode;
  revealedCategories: Record<string, boolean>;
  isReadingAloud: boolean;
  currentlyReadingIndex: number | null;
  theme: 'dark' | 'light';
  
  // Sync state
  isSyncing: boolean;
  lastSyncTime: number | null;
  syncError: string | null;

  // Actions
  addPuzzle: (name?: string, gridRows?: number, categories?: Category[]) => string;
  updatePuzzleName: (id: string, name: string) => void;
  deletePuzzle: (id: string) => void;
  setCurrentPuzzle: (id: string | null) => void;
  setScreen: (screen: AppScreen) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleCategoryReveal: (categoryId: string) => void;
  addCategory: (puzzleId: string) => void;
  updateCategory: (puzzleId: string, categoryId: string, data: Partial<Category>) => void;
  removeCategory: (puzzleId: string, categoryId: string) => void;
  setGridRows: (puzzleId: string, rows: number) => void;
  updateSolutionCell: (puzzleId: string, row: number, col: number, value: string) => void;
  bulkSetSolution: (puzzleId: string, data: string[][]) => void;
  addClue: (puzzleId: string, text: string) => void;
  addCluesBulk: (puzzleId: string, text: string) => void;
  updateClue: (puzzleId: string, clueId: string, text: string) => void;
  removeClue: (puzzleId: string, clueId: string) => void;
  reorderClues: (puzzleId: string, fromIndex: number, toIndex: number) => void;
  toggleClueSpanishWord: (puzzleId: string, clueId: string, word: string) => void;
  setIsReadingAloud: (val: boolean) => void;
  setCurrentlyReadingIndex: (idx: number | null) => void;
  resetRevealedCategories: () => void;
  revealAllCategories: () => void;
  toggleTheme: () => void;
  setPuzzlePassword: (puzzleId: string, password: string) => void;
  
  // Reorder actions (developer only)
  movePuzzleUp: (puzzleId: string) => void;
  movePuzzleDown: (puzzleId: string) => void;
  
  // Sync actions
  syncWithServer: () => Promise<void>;
  syncPuzzleToServer: (puzzleId: string) => void;
}

export const usePuzzleStore = create<PuzzleState>()(
  persist(
    (set, get) => ({
      puzzles: [],
      currentPuzzleId: null,
      currentScreen: 'puzzle-list',
      viewMode: 'clues',
      revealedCategories: {},
      isReadingAloud: false,
      currentlyReadingIndex: null,
      theme: 'dark',
      
      // Sync state
      isSyncing: false,
      lastSyncTime: null,
      syncError: null,

  addPuzzle: (name = 'New Puzzle', gridRows = 5, categories) => {
    const id = generateId();
    const cats = categories || [
      { id: generateId(), name: 'Category A', items: [] },
      { id: generateId(), name: 'Category B', items: [] },
      { id: generateId(), name: 'Category C', items: [] },
      { id: generateId(), name: 'Category D', items: [] },
      { id: generateId(), name: 'Category E', items: [] },
    ];
    const solution: string[][] = [];
    for (let r = 0; r < gridRows; r++) {
      solution.push(new Array(cats.length).fill(''));
    }
    const newPuzzle: Puzzle = {
      id,
      name,
      categories: cats,
      clues: [],
      gridRows,
      solution,
    };
    set((state) => ({ puzzles: [...state.puzzles, newPuzzle] }));
    // Sync to server (async, non-blocking)
    createPuzzleOnServer(newPuzzle).catch((err) => {
      console.error('[Sync] Failed to create puzzle on server:', err);
    });
    return id;
  },

  updatePuzzleName: (id, name) => {
    set((state) => ({
      puzzles: state.puzzles.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
    updatePuzzleOnServer(id, { name }).catch((err) => {
      console.error('[Sync] Failed to update puzzle name on server:', err);
    });
  },

  deletePuzzle: (id) => {
    set((state) => ({
      puzzles: state.puzzles.filter((p) => p.id !== id),
      currentPuzzleId: state.currentPuzzleId === id ? null : state.currentPuzzleId,
    }));
    deletePuzzleOnServer(id).catch((err) => {
      console.error('[Sync] Failed to delete puzzle on server:', err);
    });
  },

  setCurrentPuzzle: (id) => set({ currentPuzzleId: id }),
  setScreen: (screen) => set({ currentScreen: screen }),
  setViewMode: (mode) => set({ viewMode: mode }),

  toggleCategoryReveal: (categoryId) =>
    set((state) => ({
      revealedCategories: {
        ...state.revealedCategories,
        [categoryId]: !state.revealedCategories[categoryId],
      },
    })),

  addCategory: (puzzleId) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) => {
        if (p.id !== puzzleId) return p;
        const newCat: Category = {
          id: generateId(),
          name: `Category ${String.fromCharCode(65 + p.categories.length)}`,
          items: [],
        };
        // Add empty cell to each solution row
        const solution = p.solution.map((row) => [...row, '']);
        return { ...p, categories: [...p.categories, newCat], solution };
      }),
    })),

  updateCategory: (puzzleId, categoryId, data) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) =>
        p.id === puzzleId
          ? { ...p, categories: p.categories.map((c) => (c.id === categoryId ? { ...c, ...data } : c)) }
          : p
      ),
    })),

  removeCategory: (puzzleId, categoryId) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) => {
        if (p.id !== puzzleId) return p;
        const catIndex = p.categories.findIndex((c) => c.id === categoryId);
        if (catIndex === -1) return p;
        const newCats = p.categories.filter((c) => c.id !== categoryId);
        const solution = p.solution.map((row) => row.filter((_, i) => i !== catIndex));
        return { ...p, categories: newCats, solution };
      }),
    })),

  setGridRows: (puzzleId, rows) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) => {
        if (p.id !== puzzleId) return p;
        const numCols = p.categories.length;
        let solution = [...p.solution.map((r) => [...r])];
        if (rows > solution.length) {
          for (let i = solution.length; i < rows; i++) {
            solution.push(new Array(numCols).fill(''));
          }
        } else {
          solution = solution.slice(0, rows);
        }
        return { ...p, gridRows: rows, solution };
      }),
    })),

  updateSolutionCell: (puzzleId, row, col, value) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) => {
        if (p.id !== puzzleId) return p;
        const solution = p.solution.map((r) => [...r]);
        if (solution[row]) solution[row][col] = value;
        return { ...p, solution };
      }),
    })),

  bulkSetSolution: (puzzleId, data) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) => {
        if (p.id !== puzzleId) return p;
        const numCols = p.categories.length;
        // Ensure rows match, pad or trim as needed
        const solution = data.map((row) => {
          const padded = [...row];
          while (padded.length < numCols) padded.push('');
          return padded.slice(0, numCols);
        });
        return { ...p, solution };
      }),
    })),

  addClue: (puzzleId, text) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) =>
        p.id === puzzleId
          ? { ...p, clues: [...p.clues, { id: generateId(), text, order: p.clues.length }] }
          : p
      ),
    })),

  addCluesBulk: (puzzleId, text) =>
    set((state) => {
      const rawLines = text.split('\n');
      const clues: string[] = [];
      for (const raw of rawLines) {
        const trimmed = raw.trim();
        // Lines starting with a number begin a new clue
        if (/^\d+[\.\)]\s/.test(trimmed)) {
          clues.push(trimmed.replace(/^\d+[\.\)]\s*/, '').trim());
        } else if (trimmed.length > 0) {
          // Continuation line: append to the last clue (space-join)
          if (clues.length > 0) {
            clues[clues.length - 1] += ' ' + trimmed;
          } else {
            // No numbered clue yet — treat as a standalone clue
            clues.push(trimmed);
          }
        }
      }
      return {
        puzzles: state.puzzles.map((p) => {
          if (p.id !== puzzleId) return p;
          const newClues = clues.map((line, i) => ({
            id: generateId(),
            text: line,
            order: p.clues.length + i,
          }));
          return { ...p, clues: [...p.clues, ...newClues] };
        }),
      };
    }),

  updateClue: (puzzleId, clueId, text) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) =>
        p.id === puzzleId ? { ...p, clues: p.clues.map((c) => (c.id === clueId ? { ...c, text } : c)) } : p
      ),
    })),

  removeClue: (puzzleId, clueId) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) =>
        p.id === puzzleId ? { ...p, clues: p.clues.filter((c) => c.id !== clueId) } : p
      ),
    })),

  reorderClues: (puzzleId, fromIndex, toIndex) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) => {
        if (p.id !== puzzleId) return p;
        const clues = [...p.clues];
        const [removed] = clues.splice(fromIndex, 1);
        clues.splice(toIndex, 0, removed);
        return { ...p, clues: clues.map((c, i) => ({ ...c, order: i })) };
      }),
    })),

  toggleClueSpanishWord: (puzzleId, clueId, word) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) => {
        if (p.id !== puzzleId) return p;
        return {
          ...p,
          clues: p.clues.map((c) => {
            if (c.id !== clueId) return c;
            const current = c.spanishWords || [];
            const exists = current.includes(word);
            return {
              ...c,
              spanishWords: exists
                ? current.filter((w) => w !== word)
                : [...current, word],
            };
          }),
        };
      }),
    })),

  setIsReadingAloud: (val) => set({ isReadingAloud: val }),
  setCurrentlyReadingIndex: (idx) => set({ currentlyReadingIndex: idx }),
  resetRevealedCategories: () => set({ revealedCategories: {} }),
  revealAllCategories: () => set((state) => {
    const allRevealed: Record<string, boolean> = {};
    state.puzzles.forEach((p) => {
      p.categories.forEach((c) => { allRevealed[c.id] = true; });
    });
    return { revealedCategories: allRevealed };
  }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  setPuzzlePassword: (puzzleId, password) =>
    set((state) => ({
      puzzles: state.puzzles.map((p) =>
        p.id === puzzleId ? { ...p, password: password || undefined } : p
      ),
    })),
  
  // Reorder puzzles (developer only)
  movePuzzleUp: (puzzleId) => {
    const state = get();
    const puzzles = [...state.puzzles];
    const index = puzzles.findIndex((p) => p.id === puzzleId);
    if (index <= 0) return; // Already at top or not found
    
    // Swap with previous
    [puzzles[index - 1], puzzles[index]] = [puzzles[index], puzzles[index - 1]];
    
    set({ puzzles });
    updatePuzzleOrder(puzzles.map((p) => p.id)).catch((err) => {
      console.error('[Sync] Failed to update puzzle order:', err);
    });
  },
  
  movePuzzleDown: (puzzleId) => {
    const state = get();
    const puzzles = [...state.puzzles];
    const index = puzzles.findIndex((p) => p.id === puzzleId);
    if (index === -1 || index >= puzzles.length - 1) return; // Already at bottom or not found
    
    // Swap with next
    [puzzles[index], puzzles[index + 1]] = [puzzles[index + 1], puzzles[index]];
    
    set({ puzzles });
    updatePuzzleOrder(puzzles.map((p) => p.id)).catch((err) => {
      console.error('[Sync] Failed to update puzzle order:', err);
    });
  },
  
  // Sync with server — merges server puzzles into local, removes stale local puzzles deleted server-side
  syncWithServer: async () => {
    set({ isSyncing: true, syncError: null });
    
    try {
      const serverPuzzles = await fetchPuzzles();
      
      // Filter out trashed puzzles
      const visiblePuzzles = serverPuzzles.filter((p: Puzzle) => !p.name.startsWith('[TRASHED'));
      const serverIds = new Set(visiblePuzzles.map((p: Puzzle) => p.id));

      set((state) => {
        const localIds = new Set(state.puzzles.map((p) => p.id));
        // Remove local puzzles that no longer exist on the server
        const syncedPuzzles = state.puzzles
          .filter((p) => serverIds.has(p.id))
          .map((p) => {
            // If server version is newer, use the full server puzzle data
            const serverVersion = visiblePuzzles.find((sp: Puzzle) => sp.id === p.id);
            if (serverVersion && serverVersion.updatedAt && serverVersion.updatedAt > (p.updatedAt ?? 0)) {
              return { ...serverVersion };
            }
            return p;
          });
        // Only add puzzles from server that don't exist locally
        const newPuzzles = visiblePuzzles.filter((p: Puzzle) => !localIds.has(p.id));

        return {
          puzzles: [...syncedPuzzles, ...newPuzzles],
          lastSyncTime: Date.now(),
          isSyncing: false,
        };
      });
    } catch (err) {
      console.error('[Sync] Failed to fetch puzzles:', err);
      set({ isSyncing: false, syncError: 'Failed to load puzzles' });
    }
  },

  // Sync a single puzzle to server (called when leaving designer)
  syncPuzzleToServer: (puzzleId) => {
    const state = get();
    const puzzle = state.puzzles.find((p) => p.id === puzzleId);
    if (!puzzle) return;
    updatePuzzleOnServer(puzzleId, {
      name: puzzle.name,
      categories: puzzle.categories,
      clues: puzzle.clues,
      gridRows: puzzle.gridRows,
      solution: puzzle.solution,
      password: puzzle.password,
    }).catch((err) => {
      console.error('[Sync] Failed to sync puzzle to server:', err);
    });
  },
  
}),
{
  name: 'unipol-puzzles-storage',
  partialize: (state) => ({
    puzzles: state.puzzles,
    theme: state.theme,
  }),
}
  )
);
