import { describe, expect, it } from 'vitest';
import { getServiceHost, getServiceUrl } from './service-url';

const service = {
  url: 'http://nas.home.arpa:8080/app?tab=1#home',
  externalUrl: 'https://apps.example.com/downloads?tab=1#home',
};

describe('service URL selection', () => {
  it('uses the internal URL in internal mode', () => {
    expect(getServiceUrl(service, 'internal')).toBe(service.url);
    expect(getServiceHost(service, 'internal')).toBe('nas.home.arpa:8080');
  });

  it('uses the internet URL in external mode', () => {
    expect(getServiceUrl(service, 'external')).toBe(service.externalUrl);
    expect(getServiceHost(service, 'external')).toBe('apps.example.com');
  });

  it('does not fall back to an internal address when the internet URL is missing', () => {
    expect(getServiceUrl({ ...service, externalUrl: '  ' }, 'external')).toBeNull();
    expect(getServiceHost({ ...service, externalUrl: '' }, 'external')).toBeNull();
  });
});
