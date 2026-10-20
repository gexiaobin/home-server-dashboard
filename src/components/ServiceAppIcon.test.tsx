// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { ServiceAppIcon } from './ServiceAppIcon';

const service = {
  id: 'home-assistant',
  name: 'Home Assistant',
  url: 'http://ha.home.arpa:8123/lovelace',
  icon: 'house',
};

describe('ServiceAppIcon', () => {
  it('shows a bundled brand icon and hides the fallback after it loads', () => {
    const { container } = render(<ServiceAppIcon service={service} />);
    const image = container.querySelector('img');
    const fallback = container.querySelector('svg');

    expect(image).toHaveAttribute('src', '/service-icons/home-assistant.svg');
    expect(fallback).not.toHaveClass('is-hidden');

    fireEvent.load(image as HTMLImageElement);
    expect(image).toHaveClass('is-loaded');
    expect(fallback).toHaveClass('is-hidden');
  });

  it('tries the service favicon before falling back to the Lucide icon', () => {
    const { container } = render(<ServiceAppIcon service={service} />);
    let image = container.querySelector('img') as HTMLImageElement;

    fireEvent.error(image);
    image = container.querySelector('img') as HTMLImageElement;
    expect(image).toHaveAttribute('src', 'http://ha.home.arpa:8123/favicon.ico');

    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('retries icon discovery after the service URL changes', () => {
    const unknownService = {
      ...service,
      id: 'custom-service',
      name: 'Custom Service',
      url: 'http://old.example.test/app',
    };
    const { container, rerender } = render(<ServiceAppIcon service={unknownService} />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();

    rerender(<ServiceAppIcon service={{ ...unknownService, url: 'https://new.example.test/app' }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://new.example.test/favicon.ico');
  });
});
