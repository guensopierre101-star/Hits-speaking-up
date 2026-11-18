import { TranscriptLine, Segment, VocabItem } from '../types';

/**
 * Extracts YouTube video ID from various URL formats
 */
export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Direct 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Common YouTube URL regexes
  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i,
    /^[a-zA-Z0-9_-]{11}$/
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Parses timestamp string (H:MM:SS, MM:SS, M:SS) into total seconds
 */
export function parseTimestampToSeconds(timeStr: string): number | null {
  // Clean surrounding brackets or parentheses: "[01:23]" -> "01:23"
  const clean = timeStr.replace(/[\[\]\(\)]/g, '').trim();
  const parts = clean.split(':').map((p) => parseFloat(p));

  if (parts.some((p) => isNaN(p))) return null;

  if (parts.length === 2) {
    // M:SS or MM:SS
    return Math.max(0, parts[0] * 60 + parts[1]);
  } else if (parts.length === 3) {
    // H:MM:SS or HH:MM:SS
    return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }

  return null;
}

/**
 * Parses pasted YouTube transcript into structured lines: [{ index, start, text }]
 * Accepts both:
 * 1) "0:12" on its own line followed by text
 * 2) "0:12 text" on the same line
 */
export function parsePastedTranscript(rawText: string): TranscriptLine[] {
  if (!rawText || !rawText.trim()) return [];

  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const parsedLines: { start: number; text: string }[] = [];
  const timestampRegex = /^(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)(?:\]|\))?/;

  let pendingStart: number | null = null;
  let pendingTextBuffer: string[] = [];

  const flushPending = () => {
    if (pendingStart !== null && pendingTextBuffer.length > 0) {
      const combined = pendingTextBuffer.join(' ').trim();
      if (combined) {
        parsedLines.push({ start: pendingStart, text: combined });
      }
      pendingStart = null;
      pendingTextBuffer = [];
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const match = line.match(timestampRegex);

    if (match) {
      const seconds = parseTimestampToSeconds(match[1]);
      if (seconds !== null) {
        // Check if there is text after timestamp on the same line
        const restOfLine = line.slice(match[0].length).replace(/^[-:—\s]+/, '').trim();

        if (restOfLine.length > 0) {
          // Layout 2: "0:12 text" on the same line
          flushPending();
          parsedLines.push({ start: seconds, text: restOfLine });
        } else {
          // Layout 1: "0:12" on its own line
          flushPending();
          pendingStart = seconds;
        }
        continue;
      }
    }

    // It's a text line without a timestamp
    if (pendingStart !== null) {
      pendingTextBuffer.push(line);
    } else if (parsedLines.length > 0) {
      // Append text to previous parsed line if no new timestamp started
      parsedLines[parsedLines.length - 1].text += ' ' + line;
    }
  }

  flushPending();

  // Map to 1-based index
  return parsedLines.map((line, idx) => ({
    index: idx + 1,
    start: Number(line.start.toFixed(1)),
    text: line.text.trim(),
  }));
}

function tokenOverlapRatio(sourceText: string, candidateText: string): number {
  const tokenize = (str: string) =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  const srcTokens = tokenize(sourceText);
  if (srcTokens.length === 0) return 1;
  const candSet = new Set(tokenize(candidateText));
  let hits = 0;
  for (const tok of srcTokens) {
    if (candSet.has(tok)) hits++;
  }
  return hits / srcTokens.length;
}

/**
 * Computes segment timing strictly in code per requirements:
 * Segment start = start of line "from"
 * Segment end = start of the line AFTER "to" (for the last line: its start + 4 seconds)
 *
 * CRITICAL: Guarantees EVERY line from 1 to N is covered in order and verifies
 * segment text matches the actual transcript lines for [from..to].
 */
export function buildSegmentsFromGrouping(
  lines: TranscriptLine[],
  groups: {
    from: number;
    to: number;
    en: string;
    kr: string;
    vocab?: VocabItem[];
  }[]
): Segment[] {
  if (lines.length === 0) return [];

  const lineMap = new Map<number, TranscriptLine>();
  for (const l of lines) {
    lineMap.set(l.index, l);
  }

  const sortedGroups = [...groups]
    .filter((g) => Number.isFinite(g.from) && Number.isFinite(g.to))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const segments: Segment[] = [];
  let currentLineCursor = 1;

  for (let i = 0; i < sortedGroups.length; i++) {
    const grp = sortedGroups[i];
    const clampedTo = Math.min(lines.length, Math.max(1, Math.round(grp.to)));
    const clampedFrom = Math.max(currentLineCursor, Math.round(grp.from));

    if (clampedFrom > clampedTo) {
      continue;
    }

    // Include any uncovered lines before this group
    if (clampedFrom > currentLineCursor) {
      const gapLines: TranscriptLine[] = [];
      for (let g = currentLineCursor; g < clampedFrom; g++) {
        const line = lineMap.get(g);
        if (line) gapLines.push(line);
      }
      if (gapLines.length > 0) {
        const gapStart = gapLines[0].start;
        const nextLineAfterGap = lineMap.get(clampedFrom);
        const gapEnd = nextLineAfterGap ? nextLineAfterGap.start : gapStart + 3.5;
        const gapEn = gapLines.map((l) => l.text).join(' ');

        segments.push({
          id: `seg_gap_${segments.length + 1}_${Math.round(gapStart * 10)}`,
          start: Number(gapStart.toFixed(1)),
          end: Number(Math.max(gapStart + 1.5, gapEnd).toFixed(1)),
          en: gapEn,
          kr: gapEn,
          vocab: [],
        });
      }
    }

    const fromLine = lineMap.get(clampedFrom);
    if (!fromLine) continue;

    const rangeLines: TranscriptLine[] = [];
    for (let idx = clampedFrom; idx <= clampedTo; idx++) {
      const line = lineMap.get(idx);
      if (line) rangeLines.push(line);
    }
    const exactSourceEn = rangeLines.map((l) => l.text).join(' ').trim();
    const candidateEn = (grp.en || '').trim();
    const useExactSource =
      !candidateEn ||
      (exactSourceEn.split(/\s+/).length >= 3 && tokenOverlapRatio(exactSourceEn, candidateEn) < 0.35);

    const start = fromLine.start;
    const nextLine = lineMap.get(clampedTo + 1);
    let end: number;

    if (nextLine) {
      end = nextLine.start;
    } else {
      const toLine = lineMap.get(clampedTo) || fromLine;
      end = toLine.start + 4.0;
    }

    if (end <= start) {
      end = start + 3.0;
    }

    segments.push({
      id: `seg_${segments.length + 1}_${Math.round(start * 10)}`,
      start: Number(start.toFixed(1)),
      end: Number(end.toFixed(1)),
      en: useExactSource ? exactSourceEn : candidateEn,
      kr: (grp.kr || '').trim() || exactSourceEn,
      vocab: Array.isArray(grp.vocab) ? grp.vocab.slice(0, 3) : [],
    });

    currentLineCursor = Math.max(currentLineCursor, clampedTo + 1);
  }

  // Include any leftover lines after the last group
  if (currentLineCursor <= lines.length) {
    const tailLines: TranscriptLine[] = [];
    for (let t = currentLineCursor; t <= lines.length; t++) {
      const line = lineMap.get(t);
      if (line) tailLines.push(line);
    }
    if (tailLines.length > 0) {
      const tailStart = tailLines[0].start;
      const lastLine = tailLines[tailLines.length - 1];
      const tailEnd = lastLine.start + 4.0;
      const tailEn = tailLines.map((l) => l.text).join(' ');

      segments.push({
        id: `seg_tail_${segments.length + 1}_${Math.round(tailStart * 10)}`,
        start: Number(tailStart.toFixed(1)),
        end: Number(tailEnd.toFixed(1)),
        en: tailEn,
        kr: tailEn,
        vocab: [],
      });
    }
  }

  return segments;
}
