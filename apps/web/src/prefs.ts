export type ThemeName = "light" | "dark";
export type LocaleName = "zh-CN" | "en-US";
export type MotionPreference = "system" | "on" | "off";

export type Preferences = {
  theme: ThemeName;
  locale: LocaleName;
  motion: MotionPreference;
  reduceTransparency: boolean;
  leftWidth: number;
  rightWidth: number;
};

export const PREFS_KEY = "panelstudio.prefs";
export const PROJECT_KEY = "panelstudio.projectId";

const FALLBACK: Preferences = {
  theme: "light",
  locale: "zh-CN",
  motion: "system",
  reduceTransparency: false,
  leftWidth: 240,
  rightWidth: 304,
};

export function readPrefs(): Preferences {
  if (typeof localStorage === "undefined") return { ...FALLBACK };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) {
      const locale = initialLocale();
      return { ...FALLBACK, locale, theme: initialTheme() };
    }
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      locale: parsed.locale === "en-US" ? "en-US" : "zh-CN",
      motion: parsed.motion === "on" || parsed.motion === "off" ? parsed.motion : "system",
      reduceTransparency: parsed.reduceTransparency === true,
      leftWidth: clamp(parsed.leftWidth, 208, 320, 240),
      rightWidth: clamp(parsed.rightWidth, 280, 360, 304),
    };
  } catch {
    return { ...FALLBACK };
  }
}

export function writePrefs(prefs: Preferences): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function readProjectId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(PROJECT_KEY);
  return value && value.length > 0 ? value : null;
}

export function writeProjectId(projectId: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (projectId) localStorage.setItem(PROJECT_KEY, projectId);
  else localStorage.removeItem(PROJECT_KEY);
}

function initialLocale(): LocaleName {
  if (typeof navigator === "undefined") return "zh-CN";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function initialTheme(): ThemeName {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && value >= min && value <= max ? value : fallback;
}
