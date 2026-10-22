import { describe, expect, it } from 'vitest';
import { getServiceHost, getServiceUrl } from './service-url';

const service = {
  url: 'http://nas.home.arpa:8080/app?tab=1#home',
  externalUrl: 'https://apps.example.com/downloads?tab=1#home',
  scope: 'internal' as const,
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

  it('uses an external bookmark public URL in either network mode', () => {
    const bookmark = {
      scope: 'external' as const,
      url: 'https://console.aliyun.com/home',
      externalUrl: '',
    };

    expect(getServiceUrl(bookmark, 'internal')).toBe(bookmark.url);
    expect(getServiceUrl(bookmark, 'external')).toBe(bookmark.url);
    expect(getServiceHost(bookmark, 'internal')).toBe('console.aliyun.com');
    expect(getServiceHost(bookmark, 'external')).toBe('console.aliyun.com');
  });
});
