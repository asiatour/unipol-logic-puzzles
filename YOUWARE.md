# UNIPOL Logic Puzzles

A public puzzle hosting application for logic grid puzzles with presentation mode and text-to-speech clue reading. No accounts or logins required — anyone who visits can play all available puzzles.

## Terminology Convention

- **"here"** = the editing workspace (Youware platform editor / code editor)
- **"the app"** = the front end (the deployed application that players/users see)

## Project Status

- **Project Type**: React + TypeScript Modern Web Application
- **Entry Point**: `src/main.tsx`
- **Build System**: Vite 7.0.0
- **Styling System**: Tailwind CSS 3.4.17
- **State Management**: Zustand

## Features

- **Public Puzzle List**: All puzzles are visible to everyone, no login required
- **Edit Mode**: Click "Edit" to modify puzzles in the designer (categories, clues, solution)
- **Play Mode**: Click "Play" or the puzzle card to play in presentation mode
- **Read Aloud**: Text-to-speech reads clues with 6-second pauses between them
- **Logic Grid**: Interactive grid displaying category pairings
- **Category Hints**: Click category headings to reveal/hide them during play
- **Solution Display**: Toggle to show the completed puzzle answer
- **Cloud Sync**: Puzzles load from server on visit, edits sync back to server
- **Printable PDFs**: Each puzzle has a downloadable PDF (clues → blank grid → solution grid) at `/pdfs/<slug>.pdf`, linked from the puzzle card — including password-protected puzzles (the PDF is public by design). Regenerate with `python3 scripts/generate_puzzle_pdfs.py` (uses headless Chromium; requires the script's slug logic to stay in sync with `puzzlePdfFile()` in `src/App.tsx`).

## Architecture

```
src/
├── types/puzzle.ts       # TypeScript interfaces for puzzle data
├── store/puzzleStore.ts  # Zustand state management
├── components/           # (Future: extract components here)
├── App.tsx               # Main application with all screens
├── index.css             # Tailwind + custom styles
└── main.tsx              # Entry point
```

## Data Model

- **Puzzle**: Contains name, categories, clues, and solution groups
- **Category**: Named group with a list of items
- **Clue**: Text-based clue with display order
- **Solution Groups**: Array of groups, each containing one item from each category
