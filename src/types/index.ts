export interface VocabItem {
  w: string;   // English word or expression
  kr: string;  // Haitian Creole translation/meaning
}

export interface Segment {
  id: string;
  start: number;       // Start time in seconds
  end: number;         // End time in seconds
  en: string;          // English sentence spoken in the video
  kr: string;          // Natural Haitian Creole translation
  vocab: VocabItem[];  // Up to 3 useful vocab items
  cutOffsetStart?: number; // Adjustment in seconds from 'Wrong cut'
  cutOffsetEnd?: number;   // Adjustment in seconds from 'Wrong cut'
}

export interface TranscriptLine {
  index: number;       // 1-based index
  start: number;       // seconds
  text: string;        // text of this line
}

export type Verdict = 'correct' | 'partial' | 'wrong' | 'unclear';

export interface EvaluationResult {
  heard: string;       // What the user said in Creole
  verdict: Verdict;    // Judged on meaning
  feedback: string;    // Kind feedback in Haitian Creole
  better: string;      // Natural, best Creole translation
  timestamp: number;
}

export interface CachedVideoSession {
  id: string;          // YouTube video ID
  title: string;
  youtubeUrl: string;
  mode: 'transcript' | 'auto';
  segments: Segment[];
  globalOffset: number; // Global pause point shift in seconds
  createdAt: number;
  lastPracticedAt: number;
  stats?: {
    correct: number;
    partial: number;
    missed: number;
    total: number;
  };
}

export interface StarterLesson {
  id: string;
  title: string;
  description: string;
  category: string;
  youtubeUrl: string;
  transcript: string;
  segments?: Segment[];
}
