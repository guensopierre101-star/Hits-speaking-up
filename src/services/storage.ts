import { CachedVideoSession, EvaluationResult, Segment, StarterLesson } from '../types';

const STORAGE_KEY = 'translate_and_speak_cache_v2';

/**
 * Starter lessons using real, embeddable conversational YouTube videos with
 * verified time-aligned English transcripts and Haitian Creole translations
 * matching what is actually spoken at each timestamp in the video.
 */
export const STARTER_LESSONS: StarterLesson[] = [
  {
    id: 'REQI88hwwz8',
    title: 'Daily English Greetings: Conversation Practice',
    description: 'Practice everyday English greetings and polite responses about how you feel.',
    category: 'Daily Life',
    youtubeUrl: 'https://www.youtube.com/watch?v=REQI88hwwz8',
    transcript: `0:00.0 Hello, how are you?
0:04.5 Hello, I am fine today, and I feel very happy to talk with you.
0:14.5 How is your day?
0:18.5 My day is going well, and I am enjoying my time so far.
0:26.5 How do you feel today?
0:30.8 I feel good today because everything is going smoothly.
0:38.0 What do you say in the morning?
0:42.5 In the morning, I say good morning to everyone politely.
0:49.5 Do you greet people every day?`,
    segments: [
      {
        id: 'starter_greet_1',
        start: 0.0,
        end: 4.2,
        en: 'Hello, how are you?',
        kr: 'Alo, kijan ou ye?',
        vocab: [
          { w: 'hello', kr: 'alo / bonjou' },
          { w: 'how', kr: 'kijan' },
        ],
      },
      {
        id: 'starter_greet_2',
        start: 4.5,
        end: 13.8,
        en: 'Hello, I am fine today, and I feel very happy to talk with you.',
        kr: 'Alo, mwen byen jodi a, e mwen santi mwen kontan anpil pou m pale avèk ou.',
        vocab: [
          { w: 'fine', kr: 'byen' },
          { w: 'happy', kr: 'kontan' },
          { w: 'talk', kr: 'pale' },
        ],
      },
      {
        id: 'starter_greet_3',
        start: 14.5,
        end: 18.2,
        en: 'How is your day?',
        kr: 'Kijan jounen ou ye?',
        vocab: [{ w: 'day', kr: 'jounen' }],
      },
      {
        id: 'starter_greet_4',
        start: 18.5,
        end: 26.0,
        en: 'My day is going well, and I am enjoying my time so far.',
        kr: 'Jounen mwen ap pase byen, e mwen ap pwofite tan mwen jiskaprezan.',
        vocab: [
          { w: 'well', kr: 'byen' },
          { w: 'enjoying', kr: 'pwofite' },
          { w: 'so far', kr: 'jiskaprezan' },
        ],
      },
      {
        id: 'starter_greet_5',
        start: 26.5,
        end: 30.5,
        en: 'How do you feel today?',
        kr: 'Kijan ou santi ou jodi a?',
        vocab: [
          { w: 'feel', kr: 'santi' },
          { w: 'today', kr: 'jodi a' },
        ],
      },
      {
        id: 'starter_greet_6',
        start: 30.8,
        end: 37.5,
        en: 'I feel good today because everything is going smoothly.',
        kr: 'Mwen santi mwen byen jodi a paske tout bagay ap pase san pwoblèm.',
        vocab: [
          { w: 'because', kr: 'paske' },
          { w: 'everything', kr: 'tout bagay' },
          { w: 'smoothly', kr: 'san pwoblèm' },
        ],
      },
      {
        id: 'starter_greet_7',
        start: 38.0,
        end: 42.2,
        en: 'What do you say in the morning?',
        kr: 'Kisa ou di nan maten?',
        vocab: [
          { w: 'say', kr: 'di' },
          { w: 'morning', kr: 'maten' },
        ],
      },
      {
        id: 'starter_greet_8',
        start: 42.5,
        end: 49.0,
        en: 'In the morning, I say good morning to everyone politely.',
        kr: 'Nan maten, mwen di bonjou bay tout moun avèk politès.',
        vocab: [
          { w: 'everyone', kr: 'tout moun' },
          { w: 'politely', kr: 'avèk politès' },
        ],
      },
      {
        id: 'starter_greet_9',
        start: 49.5,
        end: 54.2,
        en: 'Do you greet people every day?',
        kr: 'Èske ou salye moun chak jou?',
        vocab: [
          { w: 'greet', kr: 'salye' },
          { w: 'people', kr: 'moun' },
          { w: 'every day', kr: 'chak jou' },
        ],
      },
    ],
  },
  {
    id: 'bgfdqVmVjfk',
    title: 'Ordering Food at a Restaurant',
    description: 'Real restaurant dialogue: getting a table, ordering drinks, and choosing your meal.',
    category: 'Travel & Dining',
    youtubeUrl: 'https://www.youtube.com/watch?v=bgfdqVmVjfk',
    transcript: `0:07.3 Hello! How can I help you?
0:09.6 Hello! I would like a table for four, please.
0:13.2 Of course. Please follow me.
0:18.2 Here is a table for four.
0:20.4 Thank you!
0:22.8 Could you give us the menu, please?
0:25.2 Yes, of course.
0:27.8 Here you are!
0:29.2 Thank you!
0:30.6 Can I get you anything to drink?
0:32.5 Just water for me.
0:34.2 I'll have a lemonade.
0:36.0 I'll have a milkshake.
0:38.0 I'll have an orange juice.
0:39.8 Great! I'll be right back.
0:51.5 Are you ready to order?
0:53.0 Yes, we are. I'll have the grilled chicken and a salad.
0:57.0 Would you like a starter, sir?`,
    segments: [
      {
        id: 'starter_rest_1',
        start: 7.3,
        end: 9.6,
        en: 'Hello! How can I help you?',
        kr: 'Bonjou! Kòman mwen ka ede w?',
        vocab: [
          { w: 'hello', kr: 'bonjou' },
          { w: 'help', kr: 'ede' },
        ],
      },
      {
        id: 'starter_rest_2',
        start: 9.6,
        end: 13.2,
        en: 'Hello! I would like a table for four, please.',
        kr: 'Bonjou! Mwen ta renmen yon tab pou kat moun, souple.',
        vocab: [
          { w: 'table', kr: 'tab' },
          { w: 'four', kr: 'kat' },
          { w: 'please', kr: 'souple' },
        ],
      },
      {
        id: 'starter_rest_3',
        start: 13.2,
        end: 15.7,
        en: 'Of course. Please follow me.',
        kr: 'Natirèlman. Tanpri swiv mwen.',
        vocab: [
          { w: 'of course', kr: 'natirèlman' },
          { w: 'follow', kr: 'swiv' },
        ],
      },
      {
        id: 'starter_rest_4',
        start: 18.2,
        end: 20.4,
        en: 'Here is a table for four.',
        kr: 'Men yon tab pou kat moun.',
        vocab: [
          { w: 'here is', kr: 'men' },
          { w: 'table', kr: 'tab' },
        ],
      },
      {
        id: 'starter_rest_5',
        start: 20.4,
        end: 21.9,
        en: 'Thank you!',
        kr: 'Mèsi!',
        vocab: [{ w: 'thank you', kr: 'mèsi' }],
      },
      {
        id: 'starter_rest_6',
        start: 22.8,
        end: 25.2,
        en: 'Could you give us the menu, please?',
        kr: 'Èske ou ta ka ban nou meni an, souple?',
        vocab: [
          { w: 'give', kr: 'bay' },
          { w: 'menu', kr: 'meni' },
        ],
      },
      {
        id: 'starter_rest_7',
        start: 25.2,
        end: 27.2,
        en: 'Yes, of course.',
        kr: 'Wi, natirèlman.',
        vocab: [{ w: 'yes', kr: 'wi' }],
      },
      {
        id: 'starter_rest_8',
        start: 27.8,
        end: 29.2,
        en: 'Here you are!',
        kr: 'Men li!',
        vocab: [{ w: 'here you are', kr: 'men li' }],
      },
      {
        id: 'starter_rest_9',
        start: 30.6,
        end: 32.5,
        en: 'Can I get you anything to drink?',
        kr: 'Èske mwen ka pote yon bagay pou nou bwè?',
        vocab: [
          { w: 'anything', kr: 'yon bagay' },
          { w: 'drink', kr: 'bwè' },
        ],
      },
      {
        id: 'starter_rest_10',
        start: 32.5,
        end: 34.2,
        en: 'Just water for me.',
        kr: 'Jis dlo pou mwen.',
        vocab: [
          { w: 'just', kr: 'jis' },
          { w: 'water', kr: 'dlo' },
        ],
      },
      {
        id: 'starter_rest_11',
        start: 34.2,
        end: 36.0,
        en: "I'll have a lemonade.",
        kr: 'M ap pran yon limonad.',
        vocab: [{ w: 'lemonade', kr: 'limonad' }],
      },
      {
        id: 'starter_rest_12',
        start: 36.0,
        end: 38.0,
        en: "I'll have a milkshake.",
        kr: 'M ap pran yon milkchèk.',
        vocab: [{ w: 'milkshake', kr: 'milkchèk' }],
      },
      {
        id: 'starter_rest_13',
        start: 38.0,
        end: 39.8,
        en: "I'll have an orange juice.",
        kr: 'M ap pran yon ji zoranj.',
        vocab: [{ w: 'orange juice', kr: 'ji zoranj' }],
      },
      {
        id: 'starter_rest_14',
        start: 39.8,
        end: 42.0,
        en: "Great! I'll be right back.",
        kr: 'Trè byen! M ap tounen talè.',
        vocab: [
          { w: 'great', kr: 'trè byen' },
          { w: 'right back', kr: 'tounen talè' },
        ],
      },
      {
        id: 'starter_rest_15',
        start: 51.5,
        end: 53.0,
        en: 'Are you ready to order?',
        kr: 'Èske nou pare pou kòmande?',
        vocab: [
          { w: 'ready', kr: 'pare' },
          { w: 'order', kr: 'kòmande' },
        ],
      },
      {
        id: 'starter_rest_16',
        start: 53.0,
        end: 57.0,
        en: "Yes, we are. I'll have the grilled chicken and a salad.",
        kr: 'Wi, nou pare. M ap pran poul griye ak yon salad.',
        vocab: [
          { w: 'grilled chicken', kr: 'poul griye' },
          { w: 'salad', kr: 'salad' },
        ],
      },
      {
        id: 'starter_rest_17',
        start: 57.0,
        end: 59.0,
        en: 'Would you like a starter, sir?',
        kr: 'Èske ou ta renmen yon antre, mesye?',
        vocab: [
          { w: 'starter', kr: 'antre' },
          { w: 'sir', kr: 'mesye' },
        ],
      },
    ],
  },
  {
    id: '1mHjMNZZvFo',
    title: 'Job Interview: Common Questions & Mistakes',
    description: 'Understand real English explanations on handling common job interview questions.',
    category: 'Career & Work',
    youtubeUrl: 'https://www.youtube.com/watch?v=1mHjMNZZvFo',
    transcript: `0:05.5 Hello, my name is Niharika.
0:07.5 Now, when you apply for a job and you're called for an interview, there are various questions that are asked.
0:14.8 And the better prepared you are, the more successful your interview would be.
0:20.2 Now, you might have come across various videos online that talk about the most common interview questions and answers.
0:54.3 The first most common question that is asked by an interviewer is, so, tell me something about yourself,
1:00.6 or he or she might also ask that run me through your CV.
1:07.0 Now here, the interviewer is not really interested in your answer.
1:11.5 What they are looking at is your confidence, your enthusiasm, and the passion that you answer with.
1:19.1 So, it's the best time that you show off your communication skills.`,
    segments: [
      {
        id: 'starter_int_1',
        start: 5.5,
        end: 7.5,
        en: 'Hello, my name is Niharika.',
        kr: 'Bonjou, non mwen se Niharika.',
        vocab: [{ w: 'name', kr: 'non' }],
      },
      {
        id: 'starter_int_2',
        start: 7.5,
        end: 14.5,
        en: "Now, when you apply for a job and you're called for an interview, there are various questions that are asked.",
        kr: 'Kounye a, lè ou aplike pou yon travay epi yo rele ou pou yon entèvyou, gen divès kesyon yo poze.',
        vocab: [
          { w: 'apply', kr: 'aplike' },
          { w: 'interview', kr: 'entèvyou' },
          { w: 'various', kr: 'divès' },
        ],
      },
      {
        id: 'starter_int_3',
        start: 14.8,
        end: 19.8,
        en: 'And the better prepared you are, the more successful your interview would be.',
        kr: 'Epi plis ou byen prepare, se plis entèvyou ou a ap reyisi.',
        vocab: [
          { w: 'prepared', kr: 'prepare' },
          { w: 'successful', kr: 'reyisi' },
        ],
      },
      {
        id: 'starter_int_4',
        start: 20.2,
        end: 27.8,
        en: 'Now, you might have come across various videos online that talk about the most common interview questions and answers.',
        kr: 'Kounye a, ou gendwa te wè divès videyo sou entènèt ki pale sou kesyon ak repons entèvyou ki pi komen yo.',
        vocab: [
          { w: 'common', kr: 'komen' },
          { w: 'questions', kr: 'kesyon' },
          { w: 'answers', kr: 'repons' },
        ],
      },
      {
        id: 'starter_int_5',
        start: 54.3,
        end: 60.6,
        en: 'The first most common question that is asked by an interviewer is, so, tell me something about yourself,',
        kr: 'Premye kesyon ki pi komen yon entèvyouvè konn poze se, donk, pale m yon ti kras de tèt ou,',
        vocab: [
          { w: 'interviewer', kr: 'entèvyouvè' },
          { w: 'question', kr: 'kesyon' },
        ],
      },
      {
        id: 'starter_int_6',
        start: 60.6,
        end: 66.8,
        en: 'or he or she might also ask that run me through your CV.',
        kr: 'oswa li ka mande w tou pou w pase nan CV w la avè m.',
        vocab: [
          { w: 'ask', kr: 'mande' },
          { w: 'CV', kr: 'CV' },
        ],
      },
      {
        id: 'starter_int_7',
        start: 67.0,
        end: 71.5,
        en: 'Now here, the interviewer is not really interested in your answer.',
        kr: 'Kounye a la a, entèvyouvè a pa vrèman enterese nan repons ou an.',
        vocab: [
          { w: 'interested', kr: 'enterese' },
          { w: 'answer', kr: 'repons' },
        ],
      },
      {
        id: 'starter_int_8',
        start: 71.5,
        end: 78.8,
        en: 'What they are looking at is your confidence, your enthusiasm, and the passion that you answer with.',
        kr: 'Sa y ap gade a se konfyans ou, antouzyas ou, ak pasyon ou mete lè w ap reponn.',
        vocab: [
          { w: 'confidence', kr: 'konfyans' },
          { w: 'enthusiasm', kr: 'antouzyas' },
          { w: 'passion', kr: 'pasyon' },
        ],
      },
      {
        id: 'starter_int_9',
        start: 79.1,
        end: 84.2,
        en: "So, it's the best time that you show off your communication skills.",
        kr: 'Donk, se pi bon moman pou w montre konpetans kominikasyon w.',
        vocab: [
          { w: 'communication', kr: 'kominikasyon' },
          { w: 'skills', kr: 'konpetans' },
        ],
      },
    ],
  },
];

export function getAllCachedSessions(): CachedVideoSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('Failed to load sessions from localStorage:', err);
    return [];
  }
}

export function getCachedSession(videoId: string): CachedVideoSession | null {
  const all = getAllCachedSessions();
  return all.find((s) => s.id === videoId) || null;
}

export function saveSession(session: CachedVideoSession): void {
  try {
    const all = getAllCachedSessions();
    const existingIndex = all.findIndex((s) => s.id === session.id);
    if (existingIndex >= 0) {
      all[existingIndex] = session;
    } else {
      all.unshift(session);
    }
    // Cap at 25 cached sessions
    const trimmed = all.slice(0, 25);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error('Failed to save session to localStorage:', err);
  }
}

export function updateGlobalOffset(videoId: string, offset: number): void {
  const session = getCachedSession(videoId);
  if (!session) return;
  session.globalOffset = Number(offset.toFixed(1));
  saveSession(session);
}

export function updateSegmentCut(
  videoId: string,
  segmentId: string,
  cutStart?: number,
  cutEnd?: number
): Segment[] | null {
  const session = getCachedSession(videoId);
  if (!session) return null;

  const seg = session.segments.find((s) => s.id === segmentId);
  if (seg) {
    if (cutStart !== undefined) seg.cutOffsetStart = Number(cutStart.toFixed(1));
    if (cutEnd !== undefined) seg.cutOffsetEnd = Number(cutEnd.toFixed(1));
    saveSession(session);
    return session.segments;
  }
  return null;
}

export function saveSessionStats(
  videoId: string,
  stats: { correct: number; partial: number; missed: number; total: number }
): void {
  const session = getCachedSession(videoId);
  if (!session) return;
  session.stats = stats;
  session.lastPracticedAt = Date.now();
  saveSession(session);
}

export function deleteCachedSession(videoId: string): CachedVideoSession[] {
  try {
    const updated = getAllCachedSessions().filter((s) => s.id !== videoId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Failed to delete session from localStorage:', err);
    return getAllCachedSessions();
  }
}
