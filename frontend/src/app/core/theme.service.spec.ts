import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const root = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root.style.colorScheme = '';
  });

  function createService(): ThemeService {
    const service = TestBed.inject(ThemeService);
    TestBed.tick(); // Effects ausführen
    return service;
  }

  it('follows the system setting by default', () => {
    const service = createService();

    expect(service.mode()).toBe('system');
    expect(root.style.colorScheme).toBe('light dark');
  });

  it('applies and stores a fixed mode', () => {
    const service = createService();

    service.mode.set('dark');
    TestBed.tick();

    expect(root.style.colorScheme).toBe('dark');
    expect(localStorage.getItem('cloudpoc.theme')).toBe('dark');
  });

  it('restores the stored mode', () => {
    localStorage.setItem('cloudpoc.theme', 'light');

    expect(createService().mode()).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  it('forgets the stored mode when switching back to system', () => {
    localStorage.setItem('cloudpoc.theme', 'dark');
    const service = createService();

    service.mode.set('system');
    TestBed.tick();

    expect(localStorage.getItem('cloudpoc.theme')).toBeNull();
  });

  it('ignores garbage in localStorage', () => {
    localStorage.setItem('cloudpoc.theme', 'neon');

    expect(createService().mode()).toBe('system');
  });
});
