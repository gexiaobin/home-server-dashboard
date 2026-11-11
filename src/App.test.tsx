// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Overview, Service } from './types';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  getOverview: vi.fn(),
  getTopology: vi.fn(),
  checkService: vi.fn(),
}));

vi.mock('./api', () => {
  class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { api: mocks, ApiError };
});

import { App } from './App';
import { ApiError } from './api';

const baseConfig: AppConfig = {
  settings: { title: 'HomeLab', location: 'Home', hostDisplayName: '', refreshInterval: 30_000 },
  services: [],
  topology: { source: 'manual', refreshInterval: 15_000, hosts: [], nodes: [], links: [] },
};

const ubuntu: Service = {
  id: 'ubuntu-vm',
  name: 'Ubuntu VM',
  description: 'Docker host',
  url: 'http://192.168.123.15',
  externalUrl: '',
  scope: 'internal',
  runtime: 'vm',
  category: '基础设施',
  icon: 'default',
  iconUrl: '',
  iconAllowInsecureTls: false,
  favorite: false,
  check: { type: 'none' },
};

const latestConfig: AppConfig = {
  ...baseConfig,
  services: [ubuntu],
  topology: {
    ...baseConfig.topology,
    hosts: [{ serviceId: ubuntu.id, nodeType: 'server', serviceIds: [] }],
  },
};

const overview: Overview = {
  timestamp: '2026-11-11T10:00:00.000Z',
  system: { hostname: 'NAS', detectedHostname: 'NAS', platform: 'linux', uptime: 1, loadAverage: [0, 0, 0] },
  cpu: { usage: 1, cores: 4 },
  memory: { used: 1, total: 4, percent: 25 },
  disks: [],
  network: { rxBytesPerSecond: 0, txBytesPerSecond: 0, interfaces: [] },
  temperatures: [],
  services: [],
  containers: [],
  containersAvailable: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('App config freshness', () => {
  it('reloads the latest config before showing Settings', async () => {
    mocks.getConfig
      .mockResolvedValueOnce({ config: baseConfig, revision: '"config-1"' })
      .mockResolvedValueOnce({ config: latestConfig, revision: '"config-2"' });
    mocks.getOverview.mockResolvedValue(overview);
    window.history.replaceState(null, '', '#/overview');

    render(<App />);
    await screen.findByText('HOME CONTROL CENTER');
    fireEvent.click(screen.getByRole('button', { name: /系统设置/ }));

    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('Ubuntu VM')).length).toBeGreaterThan(0);
  });

  it('reloads the latest config after a stale save is rejected', async () => {
    mocks.getConfig
      .mockResolvedValueOnce({ config: baseConfig, revision: '"config-1"' })
      .mockResolvedValueOnce({ config: baseConfig, revision: '"config-1"' })
      .mockResolvedValueOnce({ config: latestConfig, revision: '"config-2"' });
    mocks.getOverview.mockResolvedValue(overview);
    mocks.saveConfig.mockRejectedValueOnce(new ApiError('Config has changed since it was loaded', 409));
    window.history.replaceState(null, '', '#/settings');

    render(<App />);
    const saveButton = await screen.findByRole('button', { name: '保存设置' });
    fireEvent.click(saveButton);

    expect(await screen.findByText('配置已在其他页面更新，已重新加载最新内容，请再次保存')).toBeInTheDocument();
    expect((await screen.findAllByText('Ubuntu VM')).length).toBeGreaterThan(0);
    expect(mocks.saveConfig).toHaveBeenCalledWith(baseConfig, '"config-1"');
  });
});
