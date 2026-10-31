import { useState, useCallback, useRef, useEffect } from 'react';
import { usePuzzleStore } from './store/puzzleStore';
import type { Puzzle, ViewMode, PresentPhase, PlayMode, ClueDisplayMode, Category } from './types/puzzle';
import {
  Plus,
  Trash2,
  Play,
  Volume2,
  VolumeX,
  Grid3X3,
  ListOrdered,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Check,
  X,
  Pencil,
  ClipboardPaste,
  Minus,
  Sun,
  Moon,
  Save,
  CheckCircle,
  RefreshCw,
  Cloud,
  FileDown,
} from 'lucide-react';

/* ─────────── Utility ─────────── */
const uid = () => Math.random().toString(36).substring(2, 10);
const puzzles_clues_sorted = (puzzle: Puzzle) => [...puzzle.clues].sort((a, b) => a.order - b.order);

/** Detect if running inside the Youware editor preview iframe ("here") */
const isEditor = (() => { try { return window.self !== window.top; } catch { return true; } })();

/** Compute the downloadable PDF filename for a puzzle (matches scripts/generate_puzzle_pdfs.py) */
const puzzlePdfFile = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.pdf`;

/** Format a server timestamp (ms) into a human-readable relative or absolute string */
function formatUpdatedAt(ts?: number): string | null {
  if (!ts) return null;
  const now = Date.now();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  // Older than 7 days: show the date
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ────────────────────────── Bilingual TTS ────────────────────────── */
const speechRate = 0.64;

// Voice caches to avoid re-selecting on every utterance
let cachedEnVoice: SpeechSynthesisVoice | null = null;
let cachedEsVoice: SpeechSynthesisVoice | null = null;

/**
 * Select voices once per speakBilingual call.
 * enVoice: strictly en-US, gender-matched
 * esVoice: es-MX preferred, gender-matched
 */
function selectVoices(gender: 'female' | 'male'): { en: SpeechSynthesisVoice; es: SpeechSynthesisVoice } {
  const voices = window.speechSynthesis.getVoices();
  const femaleEn = /samantha|victoria|zira|jenny|aria|susan|karen|moira/i;
  const maleEn = /david|james|daniel|daniel|alex|guy|tom/i;
  const femaleEs = /paulina|mónica|monica|helena|elena|laura/i;
  const maleEs = /diego|carlos|jorge|pablo|raul|juan|angel/i;

  const enPrefer = gender === 'female' ? femaleEn : maleEn;
  const esPrefer = gender === 'female' ? femaleEs : maleEs;

  // English: MUST be en-US, reject en-GB and all other locales
  const enVoice = voices.find(v => v.lang === 'en-US' && enPrefer.test(v.name))
    || voices.find(v => v.lang === 'en-US')
    || voices.find(v => v.lang.startsWith('en-US'))
    || voices[0]; // absolute fallback

  // Spanish: prefer es-MX, fallback to any es-*
  const esVoice = voices.find(v => v.lang.startsWith('es') && esPrefer.test(v.name))
    || voices.find(v => v.lang === 'es-MX')
    || voices.find(v => v.lang.startsWith('es'))
    || enVoice; // fallback to English voice if no Spanish available

  return { en: enVoice!, es: esVoice! };
}

/**
 * Speak a bilingual clue with per-word utterances for clarity.
 * - Words marked in spanishWords get es-MX pronunciation
 * - All other words get en-US pronunciation
 * - Same voice gender for the entire clue, rotating between clues
 * - No setTimeout gaps: utterances chain directly via onend
 */
function speakBilingual(text: string, onEnd?: () => void, onError?: () => void, spanishWords?: string[], speed?: number) {
  const synth = window.speechSynthesis;
  if (!synth) { onEnd?.(); return; }

  const effectiveRate = speed != null ? speechRate * speed : speechRate;
  const hasManualMarkings = spanishWords && spanishWords.length > 0;
  const gender: 'female' | 'male' = 'male';
  const { en: enVoice, es: esVoice } = selectVoices(gender);

  // Tokenize into words and non-word chunks (spaces, punctuation)
  const rawTokens = text.match(/[\p{L}]+|[^\p{L}]+/gu) || [];
  if (rawTokens.length === 0) { onEnd?.(); return; }

  // If no manual markings, speak everything in English
  if (!hasManualMarkings) {
    const cleaned = text.replace(/\.\s*$/, '');
    const u = new SpeechSynthesisUtterance(cleaned);
    u.rate = effectiveRate;
    u.lang = 'en-US';
    u.voice = enVoice;
    u.onend = () => onEnd?.();
    u.onerror = () => onError?.();
    synth.speak(u);
    return;
  }

  // Group consecutive same-language tokens into utterances, preserving
  // original word order AND spacing/punctuation between words.
  // A language switch triggers a new utterance.
  interface Utterance { text: string; lang: string; }
  const utterances: Utterance[] = [];
  let bufText = '';
  let bufLang: 'en' | 'es' | null = null;

  for (const token of rawTokens) {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      // Whitespace: keep it in the current buffer to preserve spacing
      bufText += token;
      continue;
    }
    const isEs = spanishWords!.includes(trimmed);
    const wordLang: 'en' | 'es' = isEs ? 'es' : 'en';

    if (wordLang === bufLang) {
      bufText += token;
    } else {
      if (bufText && bufLang) {
        utterances.push({ text: bufText.replace(/\.?\s*$/, ''), lang: bufLang === 'es' ? 'es-MX' : 'en-US' });
      }
      bufText = token;
      bufLang = wordLang;
    }
  }
  if (bufText && bufLang) {
    utterances.push({ text: bufText.replace(/\.?\s*$/, ''), lang: bufLang === 'es' ? 'es-MX' : 'en-US' });
  }

  if (utterances.length === 0) { onEnd?.(); return; }

  // If only one language is present, speak it directly
  if (utterances.length === 1) {
    const u = new SpeechSynthesisUtterance(utterances[0].text.replace(/\.?\s*$/, ''));
    u.rate = effectiveRate;
    u.lang = utterances[0].lang;
    u.voice = utterances[0].lang.startsWith('es') ? esVoice : enVoice;
    u.onend = () => onEnd?.();
    u.onerror = () => onError?.();
    synth.speak(u);
    return;
  }

  // Chain utterances. A fresh SpeechSynthesisUtterance + voice assignment
  // is created for EACH segment so the TTS engine fully resets between
  // language switches — preventing voice context bleed that causes slurring.
  const LANG_PAUSE_MS = 250;

  let idx = 0;
  const speakNext = () => {
    if (idx >= utterances.length) { onEnd?.(); return; }
    const entry = utterances[idx];
    const isSpanish = entry.lang.startsWith('es');

    // Create a fresh utterance with explicit voice to force TTS engine reset
    const u = new SpeechSynthesisUtterance(entry.text);
    u.rate = effectiveRate;
    u.lang = isSpanish ? 'es-MX' : 'en-US';
    u.voice = isSpanish ? esVoice : enVoice;

    u.onend = () => {
      idx++;
      if (idx < utterances.length) {
        // Pause between all utterances to let the TTS engine settle
        setTimeout(speakNext, LANG_PAUSE_MS);
      } else {
        onEnd?.();
      }
    };
    u.onerror = () => { onError?.(); };
    u.onerror = () => { onError?.(); };
    synth.speak(u);
  };
  speakNext();
}/* ─────────── Theme Toggle Button ─────────── */
function ThemeToggle() {
  const { theme, toggleTheme } = usePuzzleStore();
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg transition-all border border-transparent hover:border-current/10"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun size={18} className="text-amber-400" />
      ) : (
        <Moon size={18} className="text-slate-600" />
      )}
    </button>
  );
}

/* ─────────── Puzzle List Screen ─────────── */
function PuzzleListScreen() {
  const { puzzles, setCurrentPuzzle, setScreen } = usePuzzleStore();
  const [passwordGateId, setPasswordGateId] = useState<string | null>(null);
  const [passwordGateTarget, setPasswordGateTarget] = useState<'present' | 'designer'>('present');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const handlePlay = (id: string) => {
    const p = puzzles.find((x) => x.id === id);
    if (p?.password) { setPasswordGateId(id); setPasswordGateTarget('present'); setPasswordInput(''); setPasswordError(false); return; }
    setCurrentPuzzle(id);
    setScreen('present');
  };

  const handleEdit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const p = puzzles.find((x) => x.id === id);
    if (p?.password) { setPasswordGateId(id); setPasswordGateTarget('designer'); setPasswordInput(''); setPasswordError(false); return; }
    setCurrentPuzzle(id);
    setScreen('designer');
  };

  const confirmPassword = () => {
    const p = puzzles.find((x) => x.id === passwordGateId);
    if (p && passwordInput === p.password) {
      setCurrentPuzzle(passwordGateId!);
      setScreen(passwordGateTarget);
      setPasswordGateId(null);
    } else {
      setPasswordError(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white">
      <header className="border-b border-white/10 backdrop-blur-sm bg-[#0a0e17]/80 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">
              <span className="text-amber-400">UNIPOL</span>{' '}
              <span className="text-white/70 font-normal">Logic Puzzles</span>
            </h1>
            <img src="/unipol-logo.jpg" alt="UNIPOL" className="h-14 w-auto ml-3 shrink-0" />
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        {puzzles.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/5 flex items-center justify-center"><Grid3X3 size={36} className="text-white/20" /></div>
            <h2 className="text-xl font-medium text-white/60 mb-2">No puzzles available</h2>
            <p className="text-white/30">Check back later for new puzzles</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {puzzles.map((puzzle) => (
              <div key={puzzle.id} onClick={() => handlePlay(puzzle.id)} className="group bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:bg-white/[0.06] hover:border-amber-400/20 transition-all cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-medium text-white truncate">{puzzle.name}{puzzle.password && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400/60 inline ml-2 align-middle"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    )}</h3>
                    <div className="flex items-center gap-4 mt-1.5 text-sm text-white/30">
                      <span>{puzzle.gridRows} rows × {puzzle.categories.length} categories</span>
                      <span>·</span>
                      <span>{puzzle.clues.length} clues</span>
                      {formatUpdatedAt(puzzle.updatedAt) && (
                        <>
                          <span>·</span>
                          <span className="text-amber-400/50">Updated {formatUpdatedAt(puzzle.updatedAt)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {isEditor && (
                      <button
                        onClick={(e) => handleEdit(puzzle.id, e)}
                        className="flex items-center gap-1.5 bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition-colors"
                      >
                        <Pencil size={14} /> Edit
                      </button>
                    )}
                    <a
                      href={`/pdfs/${puzzlePdfFile(puzzle.name)}`}
                      download
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 bg-white/[0.05] text-white/50 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-white/[0.08] hover:text-white transition-colors"
                      title="Download printable PDF (clues, blank grid, and solution)"
                    >
                      <FileDown size={14} /> PDF
                    </a>
                    <button className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-500/20 transition-colors">
                      <Play size={14} /> Play
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Password Gate Modal */}
      {passwordGateId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#131a2b] border border-white/10 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-400/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <h3 className="text-lg font-semibold text-white">Password Protected</h3>
              <p className="text-white/40 text-sm mt-1">Enter the password to access this puzzle</p>
            </div>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmPassword(); if (e.key === 'Escape') setPasswordGateId(null); }}
              placeholder="Password"
              autoFocus
              className={`w-full bg-white/[0.06] border ${passwordError ? 'border-red-400/60' : 'border-white/10'} text-white px-4 py-3 rounded-xl text-sm focus:outline-none focus:border-amber-400/60 placeholder-white/20 mb-4 transition-colors`}
            />
            {passwordError && <p className="text-red-400 text-xs mb-3 text-center">Incorrect password</p>}
            <div className="flex gap-3">
              <button onClick={() => setPasswordGateId(null)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white/50 bg-white/[0.05] hover:bg-white/[0.08] transition-colors">Cancel</button>
              <button onClick={confirmPassword} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-black bg-amber-400 hover:bg-amber-300 transition-colors">Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── Category Editor ─────────── */
function CategoryEditor({ puzzle }: { puzzle: Puzzle }) {
  const { addCategory, updateCategory, removeCategory } = usePuzzleStore();

  const handleItemChange = (catId: string, itemIndex: number, value: string) => {
    const cat = puzzle.categories.find((c) => c.id === catId);
    if (!cat) return;
    const items = [...cat.items];
    items[itemIndex] = value;
    updateCategory(puzzle.id, catId, { items });
  };

  const addItem = (catId: string) => {
    const cat = puzzle.categories.find((c) => c.id === catId);
    if (!cat) return;
    updateCategory(puzzle.id, catId, { items: [...cat.items, `Item ${cat.items.length + 1}`] });
  };

  const removeItem = (catId: string, itemIndex: number) => {
    const cat = puzzle.categories.find((c) => c.id === catId);
    if (!cat || cat.items.length <= 2) return;
    updateCategory(puzzle.id, catId, { items: cat.items.filter((_, i) => i !== itemIndex) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Categories (Columns)</h3>
        <button onClick={() => addCategory(puzzle.id)} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"><Plus size={14} /> Add</button>
      </div>
      {puzzle.categories.map((cat, catIndex) => (
        <div key={cat.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold text-amber-400/60 w-6">{String.fromCharCode(65 + catIndex)}</span>
            <input value={cat.name} onChange={(e) => updateCategory(puzzle.id, cat.id, { name: e.target.value })}
              className="bg-transparent text-white text-sm font-medium flex-1 focus:outline-none border-b border-white/10 focus:border-amber-400/40 pb-0.5" placeholder="Category name..." />
            {puzzle.categories.length > 2 && (
              <button onClick={() => removeCategory(puzzle.id, cat.id)} className="p-1 text-white/20 hover:text-red-400 transition-colors"><X size={14} /></button>
            )}
          </div>
          <div className="space-y-1.5">
            {cat.items.map((item, itemIndex) => (
              <div key={itemIndex} className="flex items-center gap-2">
                <span className="text-[10px] text-white/20 w-4 text-center">{itemIndex + 1}</span>
                <input value={item} onChange={(e) => handleItemChange(cat.id, itemIndex, e.target.value)}
                  className="bg-white/[0.03] text-white/80 text-sm px-2.5 py-1.5 rounded-lg flex-1 focus:outline-none focus:bg-white/[0.06] border border-transparent focus:border-amber-400/30" placeholder="Item..." />
                {cat.items.length > 2 && (
                  <button onClick={() => removeItem(cat.id, itemIndex)} className="p-1 text-white/15 hover:text-red-400 transition-colors"><X size={12} /></button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => addItem(cat.id)} className="mt-2 text-xs text-white/30 hover:text-amber-400 transition-colors flex items-center gap-1"><Plus size={12} /> Add item</button>
        </div>
      ))}
    </div>
  );
}

/* ─────────── Bulk Clue Input (Primary) ─────────── */
function BulkClueInput({ puzzle }: { puzzle: Puzzle }) {
  const { addCluesBulk } = usePuzzleStore();
  const [bulkText, setBulkText] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  const handlePaste = () => {
    if (bulkText.trim()) {
      addCluesBulk(puzzle.id, bulkText.trim());
      setBulkText('');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    }
  };

  const clueCount = bulkText.trim()
    ? bulkText.split('\n').filter((l) => l.replace(/^\d+[\.\)]\s*/, '').trim()).length
    : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40 flex items-center gap-1.5">
          <ClipboardPaste size={12} /> Paste numbered clues (one per line)
        </span>
        {showSuccess && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle size={12} /> Added!</span>}
      </div>
      <textarea
        value={bulkText}
        onChange={(e) => setBulkText(e.target.value)}
        className="w-full bg-white/[0.03] border border-white/[0.06] text-white text-sm px-3 py-2.5 rounded-xl focus:outline-none focus:border-amber-400/40 resize-none font-mono"
        rows={6}
        placeholder={"1. Alice drinks Coffee every morning.\n2. The person who drinks Tea enjoys Running.\n3. Carol does not drink Juice.\n4. Bob prefers Reading over Running.\n5. The person who drinks Juice likes Cooking.\n\nPaste all numbered clues here — line numbers are stripped automatically."}
      />
      <button onClick={handlePaste} disabled={!bulkText.trim()}
        className="w-full bg-amber-400 text-black px-3 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2">
        <Plus size={16} /> Add {clueCount > 0 ? `${clueCount} clue${clueCount !== 1 ? 's' : ''}` : 'clues'}
      </button>
    </div>
  );
}

/* ─────────── Clue Editor ─────────── */
function ClueEditor({ puzzle }: { puzzle: Puzzle }) {
  const { addClue, updateClue, removeClue, toggleClueSpanishWord } = usePuzzleStore();
  const [newClue, setNewClue] = useState('');
  const [editingClueId, setEditingClueId] = useState<string | null>(null);
  const [editClueText, setEditClueText] = useState('');

  const handleAdd = () => { if (newClue.trim()) { addClue(puzzle.id, newClue.trim()); setNewClue(''); } };
  const startEditClue = (clueId: string, text: string) => { setEditingClueId(clueId); setEditClueText(text); };
  const confirmEditClue = () => { if (editingClueId && editClueText.trim()) updateClue(puzzle.id, editingClueId, editClueText.trim()); setEditingClueId(null); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Clues</h3>
        <span className="text-xs text-white/30">{puzzle.clues.length} total</span>
      </div>

      {/* Bulk Paste (Primary) */}
      <BulkClueInput puzzle={puzzle} />

      {/* Single Clue Input (Secondary) */}
      <div className="border-t border-white/[0.06] pt-3">
        <span className="text-xs text-white/30 block mb-2">Or add one clue at a time:</span>
        <div className="flex gap-2">
          <textarea value={newClue} onChange={(e) => setNewClue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
            className="bg-white/[0.03] border border-white/[0.06] text-white text-sm px-3 py-2.5 rounded-xl flex-1 focus:outline-none focus:border-amber-400/40 resize-none"
            placeholder="Type a clue and press Enter..." rows={2} />
          <button onClick={handleAdd} disabled={!newClue.trim()}
            className="self-end bg-white/[0.06] text-white/60 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-white/[0.1] transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-white/[0.06]">
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* Clue List */}
      <div className="space-y-2">
        {puzzles_clues_sorted(puzzle).map((clue, index) => (
          <div key={clue.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 flex items-start gap-2.5 group">
            <span className="text-xs text-amber-400/60 font-mono mt-1.5 w-5 shrink-0">{index + 1}.</span>
            {editingClueId === clue.id ? (
              <div className="flex-1 flex gap-2">
                <textarea value={editClueText} onChange={(e) => setEditClueText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEditClue(); } if (e.key === 'Escape') setEditingClueId(null); }}
                  className="bg-white/[0.06] text-white text-sm px-2 py-1 rounded-lg flex-1 focus:outline-none border border-amber-400/30 resize-none" rows={2} autoFocus />
                <div className="flex flex-col gap-1">
                  <button onClick={confirmEditClue} className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded"><Check size={14} /></button>
                  <button onClick={() => setEditingClueId(null)} className="p-1 text-white/40 hover:bg-white/10 rounded"><X size={14} /></button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-sm flex-1 leading-relaxed flex flex-wrap gap-0.5">
                  {(clue.text.match(/[\p{L}]+|[^\p{L}]+/gu) || []).map((token, i) => {
                    const isWord = /\p{L}/u.test(token);
                    if (!isWord) {
                      return <span key={i} className="text-white/70">{token}</span>;
                    }
                    const marked = clue.spanishWords || [];
                    const isMarked = marked.includes(token);
                    return (
                      <button
                        key={`${clue.id}-${i}`}
                        onClick={() => toggleClueSpanishWord(puzzle.id, clue.id, token)}
                        className={`px-0.5 rounded transition-colors ${
                          isMarked
                            ? 'text-amber-300 bg-amber-400/15'
                            : 'text-white/70 hover:text-amber-300 hover:bg-amber-400/10'
                        }`}
                        title={isMarked ? 'Spanish pronunciation — click to remove' : 'Click for Spanish pronunciation'}
                      >
                        {token}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => startEditClue(clue.id, clue.text)} className="p-1 text-white/30 hover:text-amber-400 rounded"><Pencil size={12} /></button>
                  <button onClick={() => removeClue(puzzle.id, clue.id)} className="p-1 text-white/30 hover:text-red-400 rounded"><X size={12} /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {puzzle.clues.length === 0 && <div className="text-center py-6 text-white/20 text-sm">No clues yet</div>}
    </div>
  );
}

/* ─────────── Solution Grid Editor ─────────── */
function SolutionGridEditor({ puzzle }: { puzzle: Puzzle }) {
  const { updateSolutionCell, setGridRows, bulkSetSolution } = usePuzzleStore();
  const [rowInput, setRowInput] = useState(String(puzzle.gridRows));
  const [pasteText, setPasteText] = useState('');
  const [fillFeedback, setFillFeedback] = useState(false);

  const handleRowsChange = (val: string) => {
    setRowInput(val);
    const num = parseInt(val);
    if (!isNaN(num) && num >= 1 && num <= 20) {
      setGridRows(puzzle.id, num);
    }
  };

  // Parse pasted solution (comma separated)
  const handlePasteSolution = () => {
    if (!pasteText.trim()) return;
    const lines = pasteText.trim().split('\n').filter((l) => l.trim());
    const data = lines.map((line) =>
      line.split(',').map((cell) => cell.replace(/^\d+[\.\)]\s*/, '').trim())
    );
    bulkSetSolution(puzzle.id, data);
    setRowInput(String(data.length));
    setFillFeedback(true);
    setTimeout(() => setFillFeedback(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Solution Grid</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40">Rows:</span>
          <input type="number" min={1} max={20} value={rowInput} onChange={(e) => handleRowsChange(e.target.value)}
            className="w-14 bg-white/[0.06] text-white text-sm px-2 py-1 rounded-lg text-center border border-white/10 focus:outline-none focus:border-amber-400/40" />
        </div>
      </div>
      <p className="text-xs text-white/30">Type answers in the grid or paste them all at once.</p>

      {/* Paste solution textarea */}
      <div className="space-y-2">
        <span className="text-xs text-white/40">Paste one row per line, separate columns with commas</span>
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
          className="w-full bg-white/[0.03] border border-white/[0.06] text-white text-sm px-3 py-2.5 rounded-xl focus:outline-none focus:border-amber-400/40 resize-none font-mono"
          rows={5}
          placeholder={"Alice, Coffee, Running\nBob, Tea, Reading\nCarol, Juice, Cooking"} />
        <button onClick={handlePasteSolution} disabled={!pasteText.trim()}
          className={`w-full px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            fillFeedback ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/30' : 'bg-amber-400 text-black hover:bg-amber-300'
          }`}>
          {fillFeedback ? <><CheckCircle size={14} className="inline mr-1" />Saved!</> : 'Fill Grid'}
        </button>
      </div>

      {/* Current solution data */}
      {puzzle.solution.some((row) => row.some((cell) => cell.trim())) && (
        <div className="space-y-2">
          <span className="text-xs text-white/40">Current solution</span>
          <div className="space-y-1">
            {puzzle.solution.map((row, rowIdx) => {
              const hasData = row.some((cell) => cell.trim());
              if (!hasData) return null;
              return (
                <div key={rowIdx} className="flex items-center gap-1.5 text-xs">
                  <span className="text-amber-400/50 font-mono w-4 text-center shrink-0">{rowIdx + 1}</span>
                  <div className="flex-1 flex flex-wrap gap-1">
                    {row.map((cell, colIdx) => (
                      <span key={colIdx} className={`px-1.5 py-0.5 rounded ${cell.trim() ? 'bg-white/[0.06] text-white/70' : 'text-white/15'}`}>
                        {cell.trim() || '—'}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── Excel Grid (Answer text in cells) ─────────── */
function ExcelGrid({
  puzzle,
  showSolution,
  revealedCategories,
  onToggleCategory,
  editable,
  compact,
}: {
  puzzle: Puzzle;
  showSolution: boolean;
  revealedCategories: Record<string, boolean>;
  onToggleCategory: (categoryId: string) => void;
  editable?: boolean;
  compact?: boolean;
}) {
  const { updateSolutionCell } = usePuzzleStore();

  if (puzzle.categories.length < 2) {
    return <div className="text-center py-12 text-white/30">Add at least 2 categories to display the grid</div>;
  }

  const cellPad = compact ? 'px-3 py-2' : 'px-4 py-3';
  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse w-full" style={{ minWidth: `${puzzle.categories.length * 140 + 120}px` }}>
        <thead>
          {/* Row 1: Category names as column headers */}
          <tr>
            {/* Corner: "Category" label */}
            <th className={`${cellPad} border border-slate-600/50 bg-slate-700/50 ${textSize} font-semibold text-white/50 text-center`} style={{ minWidth: '120px' }}>
              Category
            </th>
            {puzzle.categories.map((cat) => (
              <th key={cat.id} className={`${cellPad} border border-slate-600/50 bg-slate-700/50 text-center`} style={{ minWidth: '140px' }}>
                <button
                  onClick={() => onToggleCategory(cat.id)}
                  className={`w-full rounded px-2 py-1 text-xs font-bold transition-all border ${
                    revealedCategories[cat.id]
                      ? 'bg-amber-400/20 text-amber-400 border-amber-400/40'
                      : 'bg-transparent text-white/70 border-transparent hover:border-amber-400/30'
                  }`}
                >
                  {revealedCategories[cat.id] ? (
                    <span className="flex items-center justify-center gap-1"><Eye size={11} /> {cat.name}</span>
                  ) : (
                    <span className="flex items-center justify-center gap-1"><EyeOff size={11} /> ???</span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: puzzle.gridRows }).map((_, rowIdx) => (
            <tr key={rowIdx}>
              {/* Row number */}
              <td className={`${cellPad} border border-slate-600/50 bg-slate-800/40 ${textSize} font-medium text-white/50 text-center`}>
                Row {rowIdx + 1}
              </td>
              {puzzle.categories.map((cat, colIdx) => {
                const cellValue = puzzle.solution[rowIdx]?.[colIdx] || '';
                const hasContent = cellValue.trim().length > 0;
                return (
                  <td key={cat.id} className={`${cellPad} border border-slate-600/50 ${textSize} ${
                    showSolution && hasContent ? 'bg-emerald-500/10' : 'bg-white/[0.02]'
                  }`} style={{ minWidth: '140px' }}>
                    {editable ? (
                      <input
                        value={cellValue}
                        onChange={(e) => updateSolutionCell(puzzle.id, rowIdx, colIdx, e.target.value)}
                        className="w-full bg-transparent text-white/90 text-sm text-center focus:outline-none focus:bg-white/[0.06] rounded px-1 py-0.5"
                        placeholder="—"
                      />
                    ) : (
                      <div className={`text-center whitespace-normal break-words ${hasContent ? 'text-white/80' : 'text-white/20'}`}>
                        {showSolution ? (hasContent ? cellValue : '—') : '·'}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────── Designer Screen ─────────── */
function DesignerScreen() {
  const {
    puzzles, currentPuzzleId, viewMode, setViewMode, setScreen,
    revealedCategories, toggleCategoryReveal, revealAllCategories,
    isReadingAloud, setIsReadingAloud, currentlyReadingIndex, setCurrentlyReadingIndex,
    setPuzzlePassword, syncPuzzleToServer,
  } = usePuzzleStore();

  const puzzle = puzzles.find((p) => p.id === currentPuzzleId);
  const [showSolution, setShowSolution] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [passwordValue, setPasswordValue] = useState(puzzle?.password || '');
  const readingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const stopReading = useCallback(() => {
    if (readingTimerRef.current) { clearTimeout(readingTimerRef.current); readingTimerRef.current = null; }
    window.speechSynthesis?.cancel();
    setIsReadingAloud(false);
    setCurrentlyReadingIndex(null);
  }, [setIsReadingAloud, setCurrentlyReadingIndex]);

  // Sync puzzle to server when leaving designer
  useEffect(() => {
    return () => {
      if (currentPuzzleId) syncPuzzleToServer(currentPuzzleId);
    };
  }, [currentPuzzleId, syncPuzzleToServer]);

  useEffect(() => () => stopReading(), [stopReading]);

  if (!puzzle) { setScreen('puzzle-list'); return null; }

  const handleSave = () => {
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 2000);
  };

  const readCluesAloud = () => {
    if (isReadingAloud) { stopReading(); return; }
    const sortedClues = puzzles_clues_sorted(puzzle);
    if (sortedClues.length === 0) return;
    setIsReadingAloud(true);
    setViewMode('clues');
    let index = 0;
    const speakNext = () => {
      if (index >= sortedClues.length) { setIsReadingAloud(false); setCurrentlyReadingIndex(null); return; }
      setCurrentlyReadingIndex(index);
      speakBilingual(sortedClues[index].text,
        () => { index++; if (index < sortedClues.length) { readingTimerRef.current = setTimeout(speakNext, 6000); } else { setIsReadingAloud(false); setCurrentlyReadingIndex(null); } },
        () => { setIsReadingAloud(false); setCurrentlyReadingIndex(null); },
        sortedClues[index].spanishWords
      );
    };
    speakNext();
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      <header className="border-b border-white/10 bg-[#0a0e17]/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => { stopReading(); setScreen('puzzle-list'); }} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0"><ChevronLeft size={20} /></button>
            <PuzzleNameEditor puzzle={puzzle} />
          </div>
          <div className="flex items-center bg-white/[0.05] rounded-xl p-1 shrink-0">
            {([
              { mode: 'clues' as ViewMode, icon: <ListOrdered size={16} />, label: 'Clues' },
              { mode: 'grid' as ViewMode, icon: <Grid3X3 size={16} />, label: 'Grid' },
            ]).map(({ mode, icon, label }) => (
              <button key={mode} onClick={() => { setViewMode(mode); if (mode === 'grid' && contentRef.current) contentRef.current.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === mode ? 'bg-amber-400 text-black' : 'text-white/50 hover:text-white/80'}`}>
                {icon} {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleSave}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                saveFeedback
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/30'
                  : 'bg-amber-400 text-black hover:bg-amber-300'
              }`}>
              {saveFeedback ? <><CheckCircle size={16} /> Saved!</> : <><Save size={16} /> Save</>}
            </button>
            <button onClick={readCluesAloud}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${isReadingAloud ? 'bg-red-500/20 text-red-400 border border-red-400/30' : 'bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/[0.08] border border-transparent'}`}>
              {isReadingAloud ? <VolumeX size={16} /> : <Volume2 size={16} />} {isReadingAloud ? 'Stop' : 'Read Aloud'}
            </button>
            <div className="relative">
              <button
                onClick={() => { setShowPasswordInput(!showPasswordInput); setPasswordValue(puzzle.password || ''); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${puzzle.password ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30' : 'bg-white/[0.05] text-white/40 hover:text-white/60 hover:bg-white/[0.08] border border-transparent'}`}
                title={puzzle.password ? 'Password set — click to change' : 'Set password for this puzzle'}
              >
                {puzzle.password ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
              </button>
              {showPasswordInput && (
                <div className="absolute right-0 top-full mt-2 bg-[#131a2b] border border-white/10 rounded-xl p-4 w-72 shadow-2xl z-50">
                  <label className="text-xs text-white/40 block mb-2">Set puzzle password</label>
                  <input
                    type="text"
                    value={passwordValue}
                    onChange={(e) => setPasswordValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setPuzzlePassword(puzzle.id, passwordValue.trim());
                        setShowPasswordInput(false);
                      }
                      if (e.key === 'Escape') setShowPasswordInput(false);
                    }}
                    placeholder="Enter password (empty to remove)"
                    autoFocus
                    className="w-full bg-white/[0.06] border border-white/10 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-amber-400/60 placeholder-white/20 mb-3"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setShowPasswordInput(false)} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 bg-white/[0.05] hover:bg-white/[0.08] transition-colors">Cancel</button>
                    <button onClick={() => { setPuzzlePassword(puzzle.id, passwordValue.trim()); setShowPasswordInput(false); }} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-black bg-amber-400 hover:bg-amber-300 transition-colors">Save</button>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => { setShowSolution(!showSolution); if (!showSolution) revealAllCategories(); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${showSolution ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/30' : 'bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/[0.08] border border-transparent'}`}>
              {showSolution ? <Eye size={16} /> : <EyeOff size={16} />} {showSolution ? 'Hide Solution' : 'Show Solution'}
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <aside className="w-80 border-r border-white/[0.06] bg-[#0d111c] overflow-y-auto shrink-0">
          <div className="p-4 space-y-6">
            <CategoryEditor puzzle={puzzle} />
            <div className="border-t border-white/[0.06]" />
            <SolutionGridEditor puzzle={puzzle} />
            <div className="border-t border-white/[0.06]" />
            <ClueEditor puzzle={puzzle} />
          </div>
        </aside>

        {/* Right Panel */}
        <main ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-8">
            {viewMode === 'clues' && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white/80 flex items-center gap-2"><ListOrdered size={20} className="text-amber-400" /> Puzzle Clues</h2>
                {puzzle.clues.length === 0 ? (
                  <div className="text-center py-16 text-white/20">No clues added yet. Add clues in the left panel.</div>
                ) : (
                  <div className="space-y-3">
                    {puzzles_clues_sorted(puzzle).map((clue, index) => (
                      <div key={clue.id} className={`bg-white/[0.03] border rounded-xl px-5 py-4 transition-all ${currentlyReadingIndex === index ? 'border-amber-400/50 bg-amber-400/[0.05] shadow-lg shadow-amber-400/5' : 'border-white/[0.06]'}`}>
                        <div className="flex items-start gap-3">
                          <span className="text-sm font-bold text-amber-400/70 mt-0.5 shrink-0">{index + 1}</span>
                          <p className="text-white/80 leading-relaxed">{clue.text}</p>
                        </div>
                        {currentlyReadingIndex === index && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex gap-0.5">{[0, 1, 2].map((i) => (<div key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />))}</div>
                            <span className="text-xs text-amber-400/60">Reading...</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {showSolution && (
                  <div className="mt-8">
                    <h3 className="text-sm font-semibold text-emerald-400 mb-4">Solution Grid</h3>
                    <ExcelGrid puzzle={puzzle} showSolution={true} revealedCategories={revealedCategories} onToggleCategory={toggleCategoryReveal} />
                  </div>
                )}
              </div>
            )}

            {viewMode === 'grid' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white/80 flex items-center gap-2">
                    <Grid3X3 size={20} className="text-amber-400" /> Puzzle Grid
                    {showSolution && <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">Solution</span>}
                  </h2>
                  <p className="text-xs text-white/30">Click category headings to reveal hints</p>
                </div>
                <ExcelGrid puzzle={puzzle} showSolution={showSolution} revealedCategories={revealedCategories} onToggleCategory={toggleCategoryReveal} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ─────────── Puzzle Name Editor ─────────── */
function PuzzleNameEditor({ puzzle }: { puzzle: Puzzle }) {
  const { updatePuzzleName } = usePuzzleStore();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(puzzle.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);
  const confirm = () => { if (value.trim()) updatePuzzleName(puzzle.id, value.trim()); else setValue(puzzle.name); setEditing(false); };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setValue(puzzle.name); setEditing(false); } }}
          onBlur={confirm}
          className="bg-white/10 text-white px-3 py-1.5 rounded-lg text-lg font-medium border border-amber-400/40 focus:outline-none focus:border-amber-400" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <h1 className="text-lg font-semibold text-white truncate">{puzzle.name}</h1>
      <button onClick={() => { setValue(puzzle.name); setEditing(true); }} className="p-1 text-white/30 hover:text-amber-400 transition-colors shrink-0"><Pencil size={14} /></button>
    </div>
  );
}

/* ─────────── Presentation Mode ─────────── */
function PresentScreen() {
  const {
    puzzles, currentPuzzleId, setScreen, revealedCategories, toggleCategoryReveal, revealAllCategories,
    isReadingAloud, setIsReadingAloud, currentlyReadingIndex, setCurrentlyReadingIndex,
    resetRevealedCategories,
  } = usePuzzleStore();

  const puzzle = puzzles.find((p) => p.id === currentPuzzleId);
  const [phase, setPhase] = useState<PresentPhase>('idle');
  const [playMode, setPlayMode] = useState<PlayMode>('with-clues');
  const [showSolution, setShowSolution] = useState(false);
  const [activeTab, setActiveTab] = useState<'clues' | 'grid'>('clues');
  const [clueDisplayMode, setClueDisplayMode] = useState<ClueDisplayMode | null>(null);
  const [visibleClueCount, setVisibleClueCount] = useState(0);
  const readingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedClueRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentContentRef = useRef<HTMLDivElement>(null);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [playingClueIdx, setPlayingClueIdx] = useState<number | null>(null);
  const [timedInterval, setTimedInterval] = useState(0); // seconds between clues
  const [struckClues, setStruckClues] = useState<Set<string>>(new Set());

  const toggleStrikethrough = (clueId: string) => {
    setStruckClues((prev) => {
      const next = new Set(prev);
      if (next.has(clueId)) {
        next.delete(clueId);
      } else {
        next.add(clueId);
      }
      return next;
    });
  };

  const stopAllTimers = useCallback(() => {
    if (readingTimerRef.current) { clearTimeout(readingTimerRef.current); readingTimerRef.current = null; }
    if (timedClueRef.current) { clearTimeout(timedClueRef.current); timedClueRef.current = null; }
    window.speechSynthesis?.cancel();
    setIsReadingAloud(false);
    setCurrentlyReadingIndex(null);
  }, [setIsReadingAloud, setCurrentlyReadingIndex]);

  useEffect(() => () => stopAllTimers(), [stopAllTimers]);

  if (!puzzle) return null;

  const sortedClues = puzzles_clues_sorted(puzzle);

  // ── Start reading (works for both play modes) ──
  const startReading = (mode: PlayMode) => {
    setPlayMode(mode);
    if (sortedClues.length === 0) {
      setPhase('active');
      setClueDisplayMode(mode === 'with-clues' ? 'all' : null);
      setVisibleClueCount(mode === 'with-clues' ? sortedClues.length : 0);
      return;
    }
    setPhase('reading');
    setIsReadingAloud(true);
    let index = 0;
    const speakNext = () => {
      if (index >= sortedClues.length) {
        setIsReadingAloud(false);
        setCurrentlyReadingIndex(null);
        if (mode === 'with-clues') {
          setClueDisplayMode('all');
          setVisibleClueCount(sortedClues.length);
          setPhase('active');
        } else {
          setPhase('post-read-options');
        }
        return;
      }
      setCurrentlyReadingIndex(index);
      speakBilingual(sortedClues[index].text,
        () => {
          index++;
          if (index < sortedClues.length) {
            readingTimerRef.current = setTimeout(speakNext, 6000);
          } else {
            setIsReadingAloud(false);
            setCurrentlyReadingIndex(null);
            if (mode === 'with-clues') {
              setClueDisplayMode('all');
              setVisibleClueCount(sortedClues.length);
              setPhase('active');
            } else {
              setPhase('post-read-options');
            }
          }
        },
        () => {
          setIsReadingAloud(false);
          setCurrentlyReadingIndex(null);
          if (mode === 'with-clues') {
            setClueDisplayMode('all');
            setVisibleClueCount(sortedClues.length);
            setPhase('active');
          } else {
            setPhase('post-read-options');
          }
        },
        sortedClues[index].spanishWords,
        speedMultiplier
      );
    };
    speakNext();
  };

  // ── Post-read: Show all clues ──
  const handleShowAllClues = () => {
    setClueDisplayMode('all');
    setVisibleClueCount(sortedClues.length);
    setPhase('active');
  };

  // ── Post-read: Show timed clues (one every timedInterval seconds) ──
  const handleShowTimedClues = () => {
    setClueDisplayMode('timed');
    setVisibleClueCount(1);
    setPhase('active');
    let shown = 1;
    const revealNext = () => {
      if (shown >= sortedClues.length) return;
      shown++;
      setVisibleClueCount(shown);
      timedClueRef.current = setTimeout(revealNext, timedInterval * 1000);
    };
    timedClueRef.current = setTimeout(revealNext, timedInterval * 1000);
  };

  const playSingleClue = (clueIndex: number) => {
    if (playingClueIdx !== null) {
      window.speechSynthesis?.cancel();
      setPlayingClueIdx(null);
      return;
    }
    const clue = sortedClues[clueIndex];
    if (!clue) return;
    setPlayingClueIdx(clueIndex);
    speakBilingual(
      clue.text,
      () => setPlayingClueIdx(null),
      () => setPlayingClueIdx(null),
      clue.spanishWords,
      speedMultiplier,
    );
  };

  const handleStopReading = () => { stopAllTimers(); setPlayingClueIdx(null); setPhase('active'); };
  const handleBackToIdle = () => {
    stopAllTimers();
    if (timedClueRef.current) { clearTimeout(timedClueRef.current); timedClueRef.current = null; }
    setPhase('idle');
    setShowSolution(false);
    setClueDisplayMode(null);
    setVisibleClueCount(0);
    resetRevealedCategories();
  };

  // ════════════ IDLE: Title + Two Play Buttons ════════════
  if (phase === 'idle') {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col items-center justify-center">
        <div className="text-center space-y-8 px-6">
          <div>
            <span className="text-amber-400 text-sm font-bold tracking-[0.3em] block mb-3">UNIPOL</span>
            <h1 className="text-5xl sm:text-6xl font-bold text-white leading-tight">{puzzle.name}</h1>
            <p className="text-white/30 mt-4 text-lg">
              {puzzle.clues.length} clue{puzzle.clues.length !== 1 ? 's' : ''} · {puzzle.gridRows} rows × {puzzle.categories.length} categories
            </p>
          </div>
          <div className="flex flex-col items-center gap-6">
            <div className="flex items-center justify-center gap-6">
              <div className="flex items-center gap-2 bg-white/[0.05] rounded-xl px-4 py-2">
                <span className="text-sm text-white/40">Speaking Speed</span>
                <button
                  onClick={() => setSpeedMultiplier((s) => Math.max(0.5, +(s - 0.1).toFixed(1)))}
                  disabled={speedMultiplier <= 0.5}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-lg font-bold"
                >−</button>
                <span className="text-base font-mono text-amber-400 w-12 text-center">{Math.round(speedMultiplier * 100)}%</span>
                <button
                  onClick={() => setSpeedMultiplier((s) => Math.min(1.5, +(s + 0.1).toFixed(1)))}
                  disabled={speedMultiplier >= 1.5}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-lg font-bold"
                >+</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
              <button
                onClick={() => startReading('with-clues')}
                className="inline-flex items-center justify-center gap-3 bg-amber-400 text-black px-6 py-4 rounded-xl text-lg font-bold hover:bg-amber-300 transition-all shadow-lg shadow-amber-400/20 hover:shadow-amber-400/30"
              >
                <Volume2 size={22} /> Read & Show
              </button>
              <button
                onClick={() => startReading('without-clues')}
                className="inline-flex items-center justify-center gap-3 bg-white/[0.08] text-white px-6 py-4 rounded-xl text-lg font-bold hover:bg-white/[0.12] transition-all border border-white/10"
              >
                <VolumeX size={22} /> Read & Hide
              </button>
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-1.5">
                  <span className="text-xs text-white/40">Interval</span>
                  <select
                    value={timedInterval}
                    onChange={(e) => setTimedInterval(Number(e.target.value))}
                    className="bg-white/[0.1] text-white text-sm px-2 py-1 rounded border border-white/20 focus:outline-none focus:border-emerald-400"
                  >
                    <option value={0}>0 sec</option>
                    <option value={10}>10 sec</option>
                    <option value={30}>30 sec</option>
                    <option value={60}>60 sec</option>
                  </select>
                </div>
                <button
                  onClick={() => {
                    setClueDisplayMode('timed');
                    setVisibleClueCount(1);
                    setPhase('active');
                    let shown = 1;
                    const revealNext = () => {
                      if (shown >= sortedClues.length) return;
                      shown++;
                      setVisibleClueCount(shown);
                      timedClueRef.current = setTimeout(revealNext, timedInterval * 1000);
                    };
                    timedClueRef.current = setTimeout(revealNext, timedInterval * 1000);
                  }}
                  className="inline-flex items-center justify-center gap-3 bg-emerald-500/20 text-emerald-400 px-6 py-4 rounded-xl text-lg font-bold hover:bg-emerald-500/30 transition-all border border-emerald-400/30 w-full"
                >
                  <Eye size={22} /> Display Only
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => { setScreen('puzzle-list'); stopAllTimers(); }} className="block mx-auto text-white/30 hover:text-white/60 text-sm transition-colors">
            ← Back to Puzzles
          </button>
        </div>
      </div>
    );
  }

  // ════════════ READING: Clues being read ════════════
  if (phase === 'reading') {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
        <header className="border-b border-white/10 bg-[#0a0e17]/90 backdrop-blur-sm">
          <div className="max-w-full mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={handleBackToIdle} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"><ChevronLeft size={20} /></button>
              <div>
                <span className="text-amber-400 text-xs font-bold tracking-widest">UNIPOL</span>
                <h1 className="text-xl font-bold text-white">{puzzle.name}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-1.5">
                <span className="text-xs text-white/40">Speed</span>
                  <button
                    onClick={() => setSpeedMultiplier((s) => Math.max(0.5, +(s - 0.1).toFixed(1)))}
                    disabled={speedMultiplier <= 0.5}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold"
                  >−</button>
                  <span className="text-sm font-mono text-amber-400 w-10 text-center">{Math.round(speedMultiplier * 100)}%</span>
                  <button
                    onClick={() => setSpeedMultiplier((s) => Math.min(1.0, +(s + 0.1).toFixed(1)))}
                    disabled={speedMultiplier >= 1.0}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold"
                  >+</button>
                </div>
              <span className="text-sm text-white/40">Reading clues...</span>
              <button onClick={handleStopReading} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-400/30 transition-all">
                <VolumeX size={16} /> Stop Reading
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-8">
            {/* Only show clues if playing WITH clues */}
            {playMode === 'with-clues' ? (
              <div className="space-y-4">
                {sortedClues.map((clue, index) => (
                  <div key={clue.id} className={`border rounded-xl px-6 py-5 transition-all ${
                    currentlyReadingIndex === index ? 'border-amber-400/50 bg-amber-400/[0.05] shadow-lg shadow-amber-400/5'
                    : currentlyReadingIndex !== null && index < currentlyReadingIndex ? 'border-white/[0.04] bg-white/[0.01] opacity-40'
                    : 'border-white/[0.06] bg-white/[0.03]'
                  }`}>
                    <div className="flex items-start gap-4">
                      <span className={`text-lg font-bold shrink-0 ${currentlyReadingIndex === index ? 'text-amber-400' : 'text-amber-400/40'}`}>{index + 1}</span>
                      <p className={`text-lg leading-relaxed ${currentlyReadingIndex === index ? 'text-white' : 'text-white/70'}`}>{clue.text}</p>
                    </div>
                    {currentlyReadingIndex === index && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex gap-1">{[0, 1, 2].map((i) => (<div key={i} className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />))}</div>
                        <span className="text-sm text-amber-400/60">Reading aloud...</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* Without clues: show only a listening indicator */
              <div className="flex flex-col items-center justify-center py-32 space-y-6">
                <div className="w-24 h-24 rounded-full bg-amber-400/10 flex items-center justify-center">
                  <Volume2 size={40} className="text-amber-400 animate-pulse" />
                </div>
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-white mb-2">Listen carefully...</h2>
                  <p className="text-white/40 text-lg">Clues are being read aloud</p>
                  {currentlyReadingIndex !== null && (
                    <p className="text-amber-400/60 text-sm mt-3">Clue {currentlyReadingIndex + 1} of {sortedClues.length}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ════════════ POST-READ OPTIONS: Show all / Show timed ════════════
  if (phase === 'post-read-options') {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
        <header className="border-b border-white/10 bg-[#0a0e17]/90 backdrop-blur-sm">
          <div className="max-w-full mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={handleBackToIdle} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"><ChevronLeft size={20} /></button>
              <div>
                <span className="text-amber-400 text-xs font-bold tracking-widest">UNIPOL</span>
                <h1 className="text-xl font-bold text-white">{puzzle.name}</h1>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-8 px-6">
            <div>
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Check size={36} className="text-emerald-400" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-3">All clues read!</h2>
              <p className="text-white/40 text-lg">How would you like to display the clues?</p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={handleShowAllClues}
                className="inline-flex items-center gap-3 bg-amber-400 text-black px-8 py-4 rounded-xl text-lg font-bold hover:bg-amber-300 transition-all shadow-lg shadow-amber-400/20 w-full sm:w-auto justify-center"
              >
                <ListOrdered size={22} /> Show All Clues
              </button>
              <button
                onClick={handleShowTimedClues}
                className="inline-flex items-center gap-3 bg-white/[0.08] text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-white/[0.12] transition-all border border-white/10 w-full sm:w-auto justify-center"
              >
                <Volume2 size={22} /> Show Timed Clues
              </button>
            </div>
            <p className="text-white/20 text-sm">Timed clues reveal one every 10 seconds</p>
            <button onClick={handleBackToIdle} className="block mx-auto text-white/30 hover:text-white/60 text-sm transition-colors">
              ← Back to start
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ════════════ ACTIVE: Clues displayed + Grid ════════════
  const visibleClues = clueDisplayMode === 'timed'
    ? sortedClues.slice(0, visibleClueCount)
    : sortedClues;

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col">
      <header className="border-b border-white/10 bg-[#0a0e17]/90 backdrop-blur-sm">
        <div className="max-w-full mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={handleBackToIdle} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"><ChevronLeft size={20} /></button>
            <div>
              <span className="text-amber-400 text-xs font-bold tracking-widest">UNIPOL</span>
              <h1 className="text-xl font-bold text-white">{puzzle.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-white/[0.05] rounded-xl p-1">
              <button onClick={() => setActiveTab('clues')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'clues' ? 'bg-amber-400 text-black' : 'text-white/50 hover:text-white/80'}`}><ListOrdered size={16} /> Clues</button>
              <button onClick={() => { setActiveTab('grid'); presentContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'grid' ? 'bg-amber-400 text-black' : 'text-white/50 hover:text-white/80'}`}><Grid3X3 size={16} /> Grid</button>
            </div>
            <button onClick={() => { setShowSolution(!showSolution); if (!showSolution) revealAllCategories(); }} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${showSolution ? 'bg-emerald-500 text-black' : 'bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/[0.08]'}`}>
              {showSolution ? <Eye size={16} /> : <EyeOff size={16} />} {showSolution ? 'Hide Answer' : 'Show Answer'}
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main ref={presentContentRef} className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8">
          {activeTab === 'clues' && (
            <div className="space-y-3">
              {clueDisplayMode === 'timed' && visibleClueCount < sortedClues.length && (
                <div className="text-center py-3 text-amber-400/60 text-sm">
                  Next clue in {timedInterval} seconds... ({visibleClueCount}/{sortedClues.length} shown)
                </div>
              )}
              {visibleClues.map((clue, index) => {
                const isStruck = struckClues.has(clue.id);
                return (
                <div
                  key={clue.id}
                  onClick={() => toggleStrikethrough(clue.id)}
                  className={`border rounded-xl px-6 py-5 transition-all cursor-pointer select-none ${
                    isStruck
                      ? 'opacity-40 border-white/[0.03] bg-white/[0.01]'
                      : clueDisplayMode === 'timed' && index === visibleClues.length - 1 && visibleClueCount < sortedClues.length
                        ? 'border-amber-400/30 bg-amber-400/[0.03]'
                        : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <span className={`text-lg font-bold text-amber-400/70 shrink-0 ${isStruck ? 'line-through' : ''}`}>{index + 1}</span>
                    <p className={`text-lg text-white/80 leading-relaxed flex-1 ${isStruck ? 'line-through decoration-black/40' : ''}`}>{clue.text}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); playSingleClue(index); }}
                      className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/[0.06]"
                      title={playingClueIdx === index ? 'Stop' : 'Play this clue'}
                    >
                      {playingClueIdx === index ? (
                        <VolumeX size={18} className="text-amber-400" />
                      ) : (
                        <Volume2 size={18} className="text-white/30 hover:text-white/60" />
                      )}
                    </button>
                  </div>
                </div>
                );
              })}
              {clueDisplayMode === 'timed' && visibleClueCount >= sortedClues.length && (
                <div className="text-center py-4 text-emerald-400/60 text-sm font-medium">
                  All clues revealed
                </div>
              )}
            </div>
          )}

          {activeTab === 'grid' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white/80 flex items-center gap-2"><Grid3X3 size={20} className="text-amber-400" /> Answer Grid</h2>
                <p className="text-sm text-white/30">Click category headings to reveal hints</p>
              </div>
              <ExcelGrid puzzle={puzzle} showSolution={showSolution} revealedCategories={revealedCategories} onToggleCategory={toggleCategoryReveal} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ─────────── Root App ─────────── */
export default function App() {
  const { currentScreen, theme, syncWithServer } = usePuzzleStore();
  
  // Sync with server on mount (public access - no auth required)
  useEffect(() => {
    syncWithServer();
  }, []);
  
  return (
    <div className={theme === 'light' ? 'light-mode' : ''}>
      {currentScreen === 'puzzle-list' && <PuzzleListScreen />}
      {currentScreen === 'designer' && <DesignerScreen />}
      {currentScreen === 'present' && <PresentScreen />}
    </div>
  );
}
