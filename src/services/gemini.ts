import { TranscriptLine, Segment, VocabItem, EvaluationResult, Verdict } from '../types';
import { buildSegmentsFromGrouping } from './transcriptParser';

/**
 * Client-side Gemini service:
 * Calls the application's backend server endpoints (/api/gemini/*).
 * Zero `@google/genai` imports in browser code.
 */

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch {
      lastError = new Error('Koneksyon an koupe pandan rekèt la. Tcheke entènèt ou epi eseye ankò.');
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      if (attempt < 2 && (response.status === 502 || response.status === 503 || response.status === 504)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      let errorMsg = `Server error ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMsg = errorData.error;
        }
      } catch {
        // ignore
      }
      throw new Error(errorMsg);
    }

    return response.json() as Promise<T>;
  }

  throw lastError || new Error('Koneksyon an koupe. Eseye ankò.');
}

/**
 * MODE A: Group pasted transcript lines into clean, sentence-level segments and translate to Haitian Creole.
 */
export async function groupAndTranslateTranscript(
  lines: TranscriptLine[],
  videoTitle?: string
): Promise<{ title: string; segments: Segment[] }> {
  if (lines.length === 0) {
    throw new Error('Pa gen liy transkripsyon pou analize (No transcript lines to analyze).');
  }

  const result = await postJson<{
    title?: string;
    segments: {
      from: number;
      to: number;
      en: string;
      kr: string;
      vocab: VocabItem[];
    }[];
  }>('/api/gemini/group-and-translate', {
    lines,
    videoTitle,
  });

  if (!result || !Array.isArray(result.segments) || result.segments.length === 0) {
    throw new Error('AI returned an empty segment list.');
  }

  // Timing is computed in code, never by AI!
  const finalSegments = buildSegmentsFromGrouping(lines, result.segments);
  if (finalSegments.length === 0) {
    throw new Error('Failed to match segment timing with transcript lines.');
  }

  return {
    title: result.title || videoTitle || 'YouTube Practice Lesson',
    segments: finalSegments,
  };
}

/**
 * MODE B: Auto-analyze a 60-second window of a YouTube video using backend Gemini call
 */
export async function analyzeVideoWindow(
  videoId: string,
  startSeconds: number,
  durationWindow: number = 60
): Promise<Segment[]> {
  const result = await postJson<{
    segments: {
      start: number;
      end: number;
      en: string;
      kr: string;
      vocab: VocabItem[];
    }[];
  }>('/api/gemini/analyze-video-window', {
    videoId,
    startSeconds,
    durationWindow,
  });

  if (!result || !Array.isArray(result.segments)) {
    return [];
  }

  const rawSegments = result.segments;
  const looksAbsolute =
    startSeconds > 5 &&
    rawSegments.length > 0 &&
    rawSegments.every((s) => s.start >= startSeconds - 1.0);

  const adjusted: Segment[] = [];
  for (const seg of rawSegments) {
    const relStart = looksAbsolute ? seg.start - startSeconds : seg.start;
    const relEnd = looksAbsolute ? seg.end - startSeconds : seg.end;

    // Drop segments cut by window boundary
    if (relStart < 0.2 && startSeconds > 0) continue;
    if (relEnd >= durationWindow - 0.5) continue;
    if (relEnd <= relStart) continue;

    const absStart = Number((startSeconds + relStart).toFixed(1));
    const absEnd = Number((startSeconds + relEnd).toFixed(1));

    adjusted.push({
      id: `auto_${Math.round(absStart * 10)}`,
      start: absStart,
      end: absEnd,
      en: seg.en.trim(),
      kr: seg.kr.trim(),
      vocab: Array.isArray(seg.vocab) ? seg.vocab.slice(0, 3) : [],
    });
  }

  return adjusted;
}

/**
 * Evaluate spoken voice answer in Haitian Creole against the English sentence and reference translation.
 */
export async function evaluateSpokenAnswer(
  audioBase64: string,
  englishSentence: string,
  referenceCreole: string
): Promise<EvaluationResult> {
  const result = await postJson<{
    heard?: string;
    verdict?: Verdict;
    feedback?: string;
    better?: string;
    timestamp?: number;
  }>('/api/gemini/evaluate-audio', {
    audioBase64,
    englishSentence,
    referenceCreole,
  });

  const verdict: Verdict =
    result.verdict === 'correct' ||
    result.verdict === 'partial' ||
    result.verdict === 'wrong' ||
    result.verdict === 'unclear'
      ? result.verdict
      : 'unclear';

  return {
    heard: result.heard || '',
    verdict,
    feedback: result.feedback || 'Bon travay! Kontinye pratike konsa.',
    better: result.better || referenceCreole,
    timestamp: result.timestamp || Date.now(),
  };
}

/**
 * Fallback evaluator when user chooses to type their answer.
 */
export async function evaluateTypedAnswer(
  typedCreole: string,
  englishSentence: string,
  referenceCreole: string
): Promise<EvaluationResult> {
  const result = await postJson<{
    heard?: string;
    verdict?: Verdict;
    feedback?: string;
    better?: string;
    timestamp?: number;
  }>('/api/gemini/evaluate-typed', {
    typedCreole,
    englishSentence,
    referenceCreole,
  });

  const verdict: Verdict =
    result.verdict === 'correct' ||
    result.verdict === 'partial' ||
    result.verdict === 'wrong' ||
    result.verdict === 'unclear'
      ? result.verdict
      : 'unclear';

  return {
    heard: result.heard || typedCreole,
    verdict,
    feedback: result.feedback || 'Bon efò! Kontinye pratike.',
    better: result.better || referenceCreole,
    timestamp: result.timestamp || Date.now(),
  };
}
