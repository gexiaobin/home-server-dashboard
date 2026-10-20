import { describe, expect, it } from 'vitest';
import { getServiceBrandIcon, getServiceFaviconUrl, getServiceIconSources } from './service-icons';

describe('service icon sources', () => {
  it.each([
    ['synology-dsm', 'Storage', '/service-icons/synology.svg'],
    ['custom', 'Proxmox VE', '/service-icons/proxmox.svg'],
    ['custom', 'Home Assistant', '/service-icons/home-assistant.svg'],
    ['jellyfin', 'Media', '/service-icons/jellyfin.svg'],
    ['immich', 'Photos', '/service-icons/immich.svg'],
    ['adguard', 'DNS', '/service-icons/adguard-home.svg'],
  ])('maps %s / %s to its bundled brand icon', (id, name, expected) => {
    expect(getServiceBrandIcon({ id, name })).toBe(expected);
  });

  it('builds a favicon URL from the service origin', () => {
    expect(getServiceFaviconUrl('https://example.test:8443/admin/start')).toBe(
      'https://example.test:8443/favicon.ico',
    );
  });

  it('rejects malformed and unsupported URLs', () => {
    expect(getServiceFaviconUrl('not a URL')).toBeNull();
    expect(getServiceFaviconUrl('file:///etc/passwd')).toBeNull();
  });

  it('uses the bundled brand first and the service favicon second', () => {
    expect(getServiceIconSources({
      id: 'home-assistant',
      name: 'Home Assistant',
      url: 'http://ha.home.arpa:8123/lovelace',
    })).toEqual([
      '/service-icons/home-assistant.svg',
      'http://ha.home.arpa:8123/favicon.ico',
    ]);
  });
});
