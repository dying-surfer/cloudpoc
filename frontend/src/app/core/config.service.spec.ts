import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from './config.service';

describe('ConfigService', () => {
  let service: ConfigService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads /config.json', async () => {
    const loading = service.load();
    http.expectOne('/config.json').flush({ environment: 'staging-foo', banner: 'Staging foo' });
    await loading;

    expect(service.config()).toEqual({ environment: 'staging-foo', banner: 'Staging foo' });
  });

  it('fails loudly when read before loading', () => {
    expect(() => service.config()).toThrowError(/has not completed/);
  });

  it('rejects when /config.json is missing, so the app does not start half-configured', async () => {
    const loading = service.load();
    http.expectOne('/config.json').flush('', { status: 404, statusText: 'Not Found' });

    await expect(loading).rejects.toThrow();
  });
});
