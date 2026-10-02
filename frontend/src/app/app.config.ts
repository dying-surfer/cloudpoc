import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_ICON_DEFAULT_OPTIONS, MatIconDefaultOptions } from '@angular/material/icon';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { ConfigService } from './core/config.service';
import { problemDetailsInterceptor } from './core/problem-details';

// Datums- und Zahlenformate (DatePipe usw.) auf Deutsch.
registerLocaleData(localeDe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([problemDetailsInterceptor])),
    // Die App startet erst, wenn /config.json geladen ist.
    provideAppInitializer(() => inject(ConfigService).load()),
    { provide: LOCALE_ID, useValue: 'de-DE' },
    // mat-icon nutzt standardmäßig die alte Schrift "Material Icons"; wir haben die
    // Nachfolgerin "Material Symbols" selbst gehostet (siehe angular.json).
    {
      provide: MAT_ICON_DEFAULT_OPTIONS,
      useValue: { fontSet: 'material-symbols-outlined' } satisfies MatIconDefaultOptions,
    },
  ],
};
