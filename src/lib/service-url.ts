import type { NetworkMode, Service } from '../types';

type ServiceUrls = Pick<Service, 'url' | 'externalUrl'> & Partial<Pick<Service, 'scope'>>;

export function getServiceUrl(service: ServiceUrls, networkMode: NetworkMode): string | null {
  const value = service.scope === 'external'
    ? service.url
    : networkMode === 'external'
      ? service.externalUrl
      : service.url;
  return value?.trim() || null;
}

export function getServiceHost(service: ServiceUrls, networkMode: NetworkMode): string | null {
  const url = getServiceUrl(service, networkMode);
  if (!url) return null;

  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
