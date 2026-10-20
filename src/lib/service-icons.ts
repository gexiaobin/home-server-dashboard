import type { Service } from '../types';

type IconService = Pick<Service, 'id' | 'name' | 'url'>;

const brandIcons: Array<{ match: RegExp; source: string }> = [
  { match: /\b(synology|dsm)\b/, source: '/service-icons/synology.svg' },
  { match: /\bproxmox\b/, source: '/service-icons/proxmox.svg' },
  { match: /\bhome[\s_-]*assistant\b/, source: '/service-icons/home-assistant.svg' },
  { match: /\bjellyfin\b/, source: '/service-icons/jellyfin.svg' },
  { match: /\bimmich\b/, source: '/service-icons/immich.svg' },
  { match: /\badguard(?:[\s_-]*home)?\b/, source: '/service-icons/adguard-home.svg' },
];

export function getServiceBrandIcon(service: Pick<IconService, 'id' | 'name'>): string | null {
  const identity = `${service.id} ${service.name}`.toLocaleLowerCase('en-US');
  return brandIcons.find(({ match }) => match.test(identity))?.source ?? null;
}

export function getServiceFaviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return new URL('/favicon.ico', parsed.origin).toString();
  } catch {
    return null;
  }
}

export function getServiceIconSources(service: IconService): string[] {
  return [getServiceBrandIcon(service), getServiceFaviconUrl(service.url)]
    .filter((source): source is string => Boolean(source))
    .filter((source, index, sources) => sources.indexOf(source) === index);
}
