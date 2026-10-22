// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Overview, Service } from '../types';
import { OverviewView } from './OverviewView';

const config: AppConfig = {
  settings: { title: 'HomeLab', location: 'Home', hostDisplayName: '', refreshInterval: 5000 },
  services: [],
  topology: {
    source: 'manual',
    refreshInterval: 15_000,
    vmHostServiceId: '',
    dockerHostServiceId: '',
    nodes: [],
    links: [],
  },
};

const externalBookmark: Service = {
  id: 'aliyun',
  name: 'Alibaba Cloud',
  description: 'Cloud console',
  url: 'https://home.console.aliyun.com/',
  externalUrl: '',
  scope: 'external',
  runtime: 'infrastructure',
  category: '云服务',
  icon: 'default',
  iconAllowInsecureTls: false,
  favorite: false,
  check: { type: 'none' },
};

const overview: Overview = {
  timestamp: '2026-10-21T07:17:00.000Z',
  system: {
    hostname: 'Synology DS920+',
    detectedHostname: 'DiskStation',
    platform: 'linux',
    uptime: 3600,
    loadAverage: [0.11, 0.23, 0.27],
  },
  cpu: { usage: 37.6, cores: 4 },
  memory: { used: 4, total: 16, percent: 25 },
  disks: [],
  network: { rxBytesPerSecond: 0, txBytesPerSecond: 0, interfaces: [] },
  temperatures: [],
  services: [],
  containers: [],
  containersAvailable: true,
};

afterEach(cleanup);

describe('OverviewView CPU telemetry', () => {
  it('prioritizes the current utilization and labels load averages as 1, 5, and 15 minute values', () => {
    render(
      <OverviewView config={config} overview={overview} networkMode="internal" onNavigate={vi.fn()} />,
    );

    const telemetry = screen.getByRole('region', { name: '实时遥测' });
    expect(within(telemetry).getByText('CPU 使用率')).toBeInTheDocument();
    expect(within(telemetry).getByText('38%')).toBeInTheDocument();
    expect(within(telemetry).getByText('1 / 5 / 15 分钟核心负载率')).toBeInTheDocument();
    expect(within(telemetry).getByText('3% · 6% · 7%')).toBeInTheDocument();
    expect(within(telemetry).getByText('0 / 0')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '当前 CPU 使用率' }))
      .toHaveAttribute('aria-valuenow', '38');
  });

  it('marks CPU utilization unavailable when overview data is missing', () => {
    render(
      <OverviewView config={config} overview={null} networkMode="internal" onNavigate={vi.fn()} />,
    );

    const meter = screen.getByRole('progressbar', { name: '当前 CPU 使用率' });
    expect(meter).not.toHaveAttribute('aria-valuenow');
    expect(meter).toHaveAttribute('aria-valuetext', '暂无数据');
  });

  it('distinguishes an unavailable Docker source from a valid empty list', () => {
    render(
      <OverviewView
        config={config}
        overview={{ ...overview, containersAvailable: false }}
        networkMode="internal"
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText('未连接')).toBeInTheDocument();
    expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
  });

  it('weights the storage summary across all three visible volumes', () => {
    render(
      <OverviewView
        config={config}
        overview={{
          ...overview,
          disks: [
            { mount: '/host/storage', used: 90, total: 100, percent: 90 },
            { mount: '/host/storage/volume2', used: 50, total: 500, percent: 10 },
            { mount: '/host/storage/volume3', used: 160, total: 400, percent: 40 },
          ],
        }}
        networkMode="internal"
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText('存储').parentElement).toHaveTextContent('30%存储');
  });

  it('marks retained telemetry as stale when the backend connection is lost', () => {
    render(
      <OverviewView
        config={config}
        overview={overview}
        connected={false}
        networkMode="internal"
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText('SYSTEM OFFLINE')).toBeInTheDocument();
    expect(screen.getByText('STALE TELEMETRY')).toBeInTheDocument();
    expect(screen.getByText('HOST DATA STALE')).toBeInTheDocument();
  });

  it('renders external bookmarks in their own homepage directory', () => {
    render(
      <OverviewView
        config={{ ...config, services: [externalBookmark] }}
        overview={overview}
        networkMode="internal"
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: /外网书签/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开 Alibaba Cloud' }))
      .toHaveAttribute('href', externalBookmark.url);
    expect(screen.getByText('0 REGISTERED')).toBeInTheDocument();
  });
});
