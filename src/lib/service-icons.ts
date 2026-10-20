import type { Service } from '../types';

export function getServiceIconUrl(service: Pick<Service, 'id'>): string {
  const serviceId = encodeURIComponent(service.id);
  return `/api/services/${serviceId}/icon`;
}
