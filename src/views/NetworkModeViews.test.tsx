// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Service } from '../types';
import { OverviewView } from './OverviewView';
import { ServicesView } from './ServicesView';
import { TopologyView } from './TopologyView';

const service: Service = {
  id: 'vaultwarden',
  name: 'Vaultwarden',
  description: 'Passwords',
  url: 'http://vault.home.arpa',
  externalUrl: 'https://vault.example.com',
  scope: 'internal',
  runtime: 'docker',
  category: '安全',
  icon: 'shield',
  iconAllowInsecureTls: false,
  favorite: true,
  check: { type: 'none' },
};

const bookmark: Service = {
  id: 'aliyun',
  name: '阿里云控制台',
  description: 'Cloud console',
  url: 'https://console.aliyun.com/',
  externalUrl: '',
  scope: 'external',
  runtime: 'infrastructure',
  category: '云服务',
  icon: 'globe',
  iconAllowInsecureTls: false,
  favorite: true,
  check: { type: 'none' },
};

const config: AppConfig = {
  settings: { title: 'HomeLab', location: 'Home', hostDisplayName: '', refreshInterval: 5000 },
  services: [service],
  topology: {
    source: 'manual',
    refreshInterval: 15_000,
    vmHostServiceId: '',
    dockerHostServiceId: '',
    nodes: [{ id: 'vault', label: 'Vault', type: 'container', serviceId: service.id, x: 50, y: 50 }],
    links: [],
  },
};

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

afterEach(cleanup);

describe('network mode navigation', () => {
  it('switches service directory links and disables missing internet URLs', () => {
    const props = {
      services: [service],
      health: [],
      search: '',
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      onToggleFavorite: vi.fn(),
    };
    const { rerender } = render(<ServicesView {...props} networkMode="internal" />);

    expect(screen.getByRole('link', { name: '打开 Vaultwarden' })).toHaveAttribute('href', service.url);

    rerender(<ServicesView {...props} networkMode="external" />);
    expect(screen.getByRole('link', { name: '打开 Vaultwarden' })).toHaveAttribute('href', service.externalUrl);

    rerender(<ServicesView {...props} services={[{ ...service, externalUrl: '' }]} networkMode="external" />);
    expect(screen.getByRole('button', { name: 'Vaultwarden 未配置互联网地址' })).toBeDisabled();
  });

  it('separates external bookmarks and always opens their public URL without health metadata', () => {
    const props = {
      services: [service, bookmark],
      health: [
        { id: service.id, status: 'up' as const, latency: 12, checkedAt: '2026-10-22T08:00:00.000Z' },
        { id: bookmark.id, status: 'up' as const, latency: 8, checkedAt: '2026-10-22T08:00:00.000Z' },
      ],
      search: '',
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      onToggleFavorite: vi.fn(),
    };
    const { rerender } = render(<ServicesView {...props} networkMode="internal" />);
    const internalDirectory = screen.getByRole('region', { name: '内网服务' });
    const bookmarkDirectory = screen.getByRole('region', { name: '外网书签' });

    expect(within(internalDirectory).getByRole('link', { name: '打开 Vaultwarden' })).toHaveAttribute('href', service.url);
    expect(within(bookmarkDirectory).getByRole('link', { name: '打开 阿里云控制台' })).toHaveAttribute('href', bookmark.url);
    expect(within(bookmarkDirectory).getByText('外网书签', { selector: '.bookmark-scope-label' })).toBeInTheDocument();
    expect(within(bookmarkDirectory).queryByText('最近检测')).not.toBeInTheDocument();
    expect(within(bookmarkDirectory).queryByText('在线')).not.toBeInTheDocument();

    rerender(<ServicesView {...props} networkMode="external" />);
    expect(within(screen.getByRole('region', { name: '外网书签' })).getByRole('link', { name: '打开 阿里云控制台' }))
      .toHaveAttribute('href', bookmark.url);
  });

  it('uses the active URL on the overview launch surface', () => {
    render(<OverviewView config={config} overview={null} networkMode="external" onNavigate={vi.fn()} />);

    expect(screen.getByRole('link', { name: '打开 Vaultwarden' })).toHaveAttribute('href', service.externalUrl);
  });

  it('shows the discovered service icon on the overview launch surface and keeps the fallback', () => {
    const { container } = render(
      <OverviewView config={config} overview={null} networkMode="internal" onNavigate={vi.fn()} />,
    );
    const icon = container.querySelector('.launch-card .service-app-icon');
    const image = icon?.querySelector('img');
    const fallback = icon?.querySelector('svg');

    expect(image).toHaveAttribute('src', '/api/services/vaultwarden/icon');
    expect(fallback).not.toHaveClass('is-hidden');

    fireEvent.load(image as HTMLImageElement);
    expect(image).toHaveClass('is-loaded');
    expect(fallback).toHaveClass('is-hidden');

    fireEvent.error(image as HTMLImageElement);
    expect(icon?.querySelector('img')).toBeNull();
    expect(fallback).not.toHaveClass('is-hidden');
  });

  it('uses the active URL in the topology inspector', () => {
    render(
      <TopologyView
        topology={config.topology}
        services={config.services}
        health={[]}
        networkMode="external"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Vaultwarden/ }));
    expect(screen.getByRole('link', { name: '打开服务' })).toHaveAttribute('href', service.externalUrl);
  });
});
