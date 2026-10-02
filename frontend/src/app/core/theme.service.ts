import { DOCUMENT, effect, inject, Injectable, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'cloudpoc.theme';

/** Wert für die CSS-Eigenschaft color-scheme; `light dark` folgt der Systemeinstellung. */
const COLOR_SCHEME: Record<ThemeMode, string> = {
  system: 'light dark',
  light: 'light',
  dark: 'dark',
};

/**
 * Hell/Dunkel-Umschalter. Der Modus steht in localStorage, damit die Wahl einen Reload
 * überlebt; "system" ist der Standard und wird nicht gespeichert.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly mode = signal<ThemeMode>(this.readStoredMode());

  constructor() {
    effect(() => {
      const mode = this.mode();
      this.document.documentElement.style.colorScheme = COLOR_SCHEME[mode];
      this.storeMode(mode);
    });
  }

  private readStoredMode(): ThemeMode {
    const stored = this.storage()?.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  }

  private storeMode(mode: ThemeMode): void {
    if (mode === 'system') {
      this.storage()?.removeItem(STORAGE_KEY);
    } else {
      this.storage()?.setItem(STORAGE_KEY, mode);
    }
  }

  /** localStorage kann fehlen oder gesperrt sein (z. B. private Fenster); dann ohne Speichern. */
  private storage(): Storage | null {
    try {
      return this.document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
