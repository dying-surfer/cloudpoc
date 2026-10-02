import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ConfigService } from './core/config.service';
import { ThemeMode, ThemeService } from './core/theme.service';

interface ThemeOption {
  mode: ThemeMode;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly config = inject(ConfigService).config;
  protected readonly theme = inject(ThemeService);

  protected readonly themeOptions: ThemeOption[] = [
    { mode: 'system', label: 'System', icon: 'brightness_auto' },
    { mode: 'light', label: 'Hell', icon: 'light_mode' },
    { mode: 'dark', label: 'Dunkel', icon: 'dark_mode' },
  ];

  protected readonly currentThemeOption = computed(() =>
    this.themeOptions.find((option) => option.mode === this.theme.mode())!,
  );
}
