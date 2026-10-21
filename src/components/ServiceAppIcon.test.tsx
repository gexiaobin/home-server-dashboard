// @vitest-environment jsdom

import { act, fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { ServiceAppIcon } from './ServiceAppIcon';

const service = {
  id: 'home-assistant',
  name: 'qBittorrent',
  url: 'http://192.0.2.8:8080/#/login',
  icon: 'house',
  iconAllowInsecureTls: false,
};

describe('ServiceAppIcon', () => {
  it('loads the icon through the service API instead of matching the service name or id', () => {
    const { container } = render(<ServiceAppIcon service={service} />);
    const image = container.querySelector('img');
    const fallback = container.querySelector('svg');

    expect(image).toHaveAttribute(
      'src',
      '/api/services/home-assistant/icon',
    );
    expect(fallback).not.toHaveClass('is-hidden');

    fireEvent.load(image as HTMLImageElement);
    expect(image).toHaveClass('is-loaded');
    expect(fallback).toHaveClass('is-hidden');
  });

  it('falls back to the configured Lucide icon when discovery fails', () => {
    const { container } = render(<ServiceAppIcon service={service} />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('retries one transient failure after the server negative cache expires', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<ServiceAppIcon service={service} />);
      fireEvent.error(container.querySelector('img') as HTMLImageElement);

      act(() => vi.advanceTimersByTime(60_000));
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        '/api/services/home-assistant/icon',
      );

      fireEvent.error(container.querySelector('img') as HTMLImageElement);
      act(() => vi.advanceTimersByTime(60_000));
      expect(container.querySelector('img')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries icon discovery after the service URL changes', () => {
    const unknownService = {
      ...service,
      id: 'custom-service',
      url: 'http://old.example.test/app',
    };
    const { container, rerender } = render(<ServiceAppIcon service={unknownService} />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();

    rerender(<ServiceAppIcon service={{ ...unknownService, url: 'https://new.example.test/app' }} />);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/services/custom-service/icon',
    );

    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    rerender(<ServiceAppIcon service={unknownService} />);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/services/custom-service/icon',
    );
  });

  it('retries immediately after insecure TLS is enabled for the service', () => {
    const { container, rerender } = render(<ServiceAppIcon service={service} />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();

    rerender(<ServiceAppIcon service={{ ...service, iconAllowInsecureTls: true }} />);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/services/home-assistant/icon',
    );
  });
});
