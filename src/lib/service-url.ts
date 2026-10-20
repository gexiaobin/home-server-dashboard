import type { NetworkMode, Service } from '../types';

type ServiceUrls = Pick<Service, 'url' | 'externalUrl'>;

export function getServiceUrl(service: ServiceUrls, networkMode: NetworkMode): string | null {
  const value = networkMode === 'external' ? service.externalUrl : service.url;
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
