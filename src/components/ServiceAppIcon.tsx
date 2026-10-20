import { useEffect, useState } from 'react';
import { getServiceIconSources } from '../lib/service-icons';
import type { Service } from '../types';
import { getServiceIcon } from './icons';

interface ServiceAppIconProps {
  service: Pick<Service, 'id' | 'name' | 'url' | 'icon'>;
}

export function ServiceAppIcon({ service }: ServiceAppIconProps) {
  const FallbackIcon = getServiceIcon(service.icon);
  const sources = getServiceIconSources(service);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const source = sources.find((candidate) => !failedSources.includes(candidate)) ?? null;
  const imageLoaded = source !== null && loadedSource === source;

  useEffect(() => {
    setFailedSources([]);
    setLoadedSource(null);
  }, [service.id, service.name, service.url]);

  return (
    <span className="service-icon service-app-icon" aria-hidden="true">
      <FallbackIcon
        className={`service-app-icon-fallback ${imageLoaded ? 'is-hidden' : ''}`}
        size={20}
        strokeWidth={1.7}
      />
      {source && (
        <img
          className={`service-app-icon-image ${imageLoaded ? 'is-loaded' : ''}`}
          src={source}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSource(source)}
          onError={() => {
            setLoadedSource(null);
            setFailedSources((current) => current.includes(source) ? current : [...current, source]);
          }}
        />
      )}
    </span>
  );
}
