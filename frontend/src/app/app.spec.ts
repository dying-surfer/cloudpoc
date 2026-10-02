import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AppConfig, ConfigService } from './core/config.service';

describe('App', () => {
  const config = signal<AppConfig>({ environment: 'dev', banner: 'DEV · Test' });

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: ConfigService, useValue: { config } }],
    }).compileComponents();
  });

  it('shows the environment banner from the runtime config', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const banner = (fixture.nativeElement as HTMLElement).querySelector('.env-banner');
    expect(banner?.textContent).toContain('DEV · Test');
  });

  it('shows no banner when the config has none', async () => {
    config.set({ environment: 'prod', banner: null });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.env-banner')).toBeNull();
  });
});
