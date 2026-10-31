export interface Category {
  id: string;
  name: string;
  items: string[];
}

export interface Clue {
  id: string;
  text: string;
  order: number;
  /** Words/phrases the user has explicitly marked for Mexican Spanish pronunciation */
  spanishWords?: string[];
}

export interface Puzzle {
  id: string;
  name: string;
  categories: Category[];
  clues: Clue[];
  /** Number of answer rows in the grid (not including category header) */
  gridRows: number;
  /** 2D solution array: solution[row][catIndex] = answer text */
  solution: string[][];
  /** Optional password to gate access to this puzzle */
  password?: string;
  /** Timestamp (ms) when the puzzle was last updated on the server */
  updatedAt?: number;
  /** Timestamp (ms) when the puzzle was created on the server */
  createdAt?: number;
}

export type ViewMode = 'clues' | 'grid' | 'solution';

export type AppScreen = 'puzzle-list' | 'designer' | 'present';

export type PresentPhase = 'idle' | 'reading' | 'post-read-options' | 'active';

export type PlayMode = 'with-clues' | 'without-clues';

export type ClueDisplayMode = 'all' | 'timed';
