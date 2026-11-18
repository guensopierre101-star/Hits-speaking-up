export type ThemeId = 'amber-glass' | 'hits' | 'ivory' | 'oxford' | 'midnight';

export interface AppTheme {
  id: ThemeId;
  name: string;
  description: string;
  themeColor: string;
  isDark: boolean;
  swatches: {
    bg: string;
    surface: string;
    primary: string;
    accent: string;
  };
}

const THEME_STORAGE_KEY = 'hits_speakup_theme_v2';

export const APP_THEMES: AppTheme[] = [
  {
    id: 'amber-glass',
    name: 'Amber Glass',
    description: 'Vè fimen fonse ak ekla lò/oranj',
    themeColor: '#12100E',
    isDark: true,
    swatches: {
      bg: '#12100E',
      surface: '#2A2521',
      primary: '#E86A17',
      accent: '#F59E0B',
    },
  },
  {
    id: 'hits',
    name: 'HITS Klasik',
    description: 'Blan vè glase ak ble wayal',
    themeColor: '#EEF2FF',
    isDark: false,
    swatches: {
      bg: '#F4F7FF',
      surface: '#FFFFFF',
      primary: '#002DF9',
      accent: '#F10401',
    },
  },
  {
    id: 'ivory',
    name: 'Papye Krèm',
    description: 'Ton cho klasik, dous pou je',
    themeColor: '#F7F3EC',
    isDark: false,
    swatches: {
      bg: '#F7F3EC',
      surface: '#FFFDF9',
      primary: '#1E40AF',
      accent: '#C81E1E',
    },
  },
  {
    id: 'oxford',
    name: 'Oxford Vè',
    description: 'Vè akademik ak blan pwòp',
    themeColor: '#F0F6F2',
    isDark: false,
    swatches: {
      bg: '#F0F6F2',
      surface: '#FFFFFF',
      primary: '#166534',
      accent: '#DC2626',
    },
  },
  {
    id: 'midnight',
    name: 'Nuit Klasik',
    description: 'Ble marin fènwa ak vè glase',
    themeColor: '#0B1120',
    isDark: true,
    swatches: {
      bg: '#0B1120',
      surface: '#162033',
      primary: '#2563EB',
      accent: '#EF4444',
    },
  },
];

export function getSavedTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (
      raw === 'amber-glass' ||
      raw === 'hits' ||
      raw === 'ivory' ||
      raw === 'oxford' ||
      raw === 'midnight'
    ) {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return 'amber-glass';
}

export function applyTheme(themeId: ThemeId): void {
  const theme = APP_THEMES.find((t) => t.id === themeId) || APP_THEMES[0];

  if (typeof document !== 'undefined') {
    if (theme.id === 'amber-glass') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme.id);
    }

    document.documentElement.classList.toggle('dark', theme.isDark);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme.themeColor);
    }
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // ignore storage errors
  }
}
