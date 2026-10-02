import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Runtime-Konfiguration aus /config.json.
 *
 * Sie wird erst beim Start im Browser geladen, nicht beim Build eingebaut. So läuft dasselbe
 * Image in jeder Umgebung ("build once, deploy many"); nur die config.json unterscheidet sich
 * (ab M4 per Volume bzw. ConfigMap).
 */
export interface AppConfig {
  /** Name der Umgebung, z. B. "dev", "staging-foo", "prod". */
  environment: string;
  /** Text für das Umgebungs-Banner; ohne Text (z. B. in Prod) kein Banner. */
  banner?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private readonly loaded = signal<AppConfig | null>(null);

  /** Steht ab dem App-Start bereit, weil provideAppInitializer auf load() wartet. */
  readonly config = computed(() => {
    const config = this.loaded();
    if (config === null) {
      throw new Error('ConfigService.load() has not completed yet');
    }
    return config;
  });

  async load(): Promise<void> {
    this.loaded.set(await firstValueFrom(this.http.get<AppConfig>('/config.json')));
  }
}
