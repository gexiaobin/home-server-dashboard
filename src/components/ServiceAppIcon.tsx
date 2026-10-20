import { useEffect, useState } from 'react';
import { getServiceIconUrl } from '../lib/service-icons';
import type { Service } from '../types';
import { getServiceIcon } from './icons';

interface ServiceAppIconProps {
  service: Pick<Service, 'id' | 'url' | 'icon'>;
}

export function ServiceAppIcon({ service }: ServiceAppIconProps) {
  const sourceKey = `${service.id}\n${service.url}`;

  return (
    <ServiceAppIconSource
      key={sourceKey}
      source={getServiceIconUrl(service)}
      fallbackIcon={service.icon}
    />
  );
}

function ServiceAppIconSource({ source, fallbackIcon }: { source: string; fallbackIcon: string }) {
  const FallbackIcon = getServiceIcon(fallbackIcon);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!imageFailed || retryCount >= 1) return undefined;
    const retryTimer = window.setTimeout(() => {
      setRetryCount((current) => current + 1);
      setImageFailed(false);
    }, 60_000);
    return () => window.clearTimeout(retryTimer);
  }, [imageFailed, retryCount]);

  return (
    <span className="service-icon service-app-icon" aria-hidden="true">
      <FallbackIcon
        className={`service-app-icon-fallback ${imageLoaded ? 'is-hidden' : ''}`}
        size={20}
        strokeWidth={1.7}
      />
      {!imageFailed && (
        <img
          className={`service-app-icon-image ${imageLoaded ? 'is-loaded' : ''}`}
          src={source}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageLoaded(false);
            setImageFailed(true);
          }}
        />
      )}
    </span>
  );
}
