// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { AppConfig, TopologySnapshot } from '../types';
import { TopologyView } from './TopologyView';

const manualTopology: AppConfig['topology'] = {
  source: 'manual',
  refreshInterval: 15_000,
  nodes: [{ id: 'manual-router', label: '手工路由器', type: 'router', x: 50, y: 30 }],
  links: [],
};

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TopologyView', () => {
  it('renders live iKuai nodes, traffic, and device details', async () => {
    const snapshot: TopologySnapshot = {
      requestedSource: 'ikuai',
      source: 'ikuai',
      status: 'live',
      updatedAt: '2026-10-21T12:00:00.000Z',
      nodes: [{
        id: 'router',
        label: 'iKuai 主路由',
        type: 'router',
        status: 'up',
        x: 50,
        y: 28,
        ipAddress: '192.0.2.1',
        cpuUsage: 12,
      }],
      links: [],
      stats: {
        onlineClients: 18,
        knownDevices: 18,
        linkedInterfaces: 2,
        download: 2_048,
        upload: 1_024,
      },
    };
    vi.spyOn(api, 'getTopology').mockResolvedValue(snapshot);

    render(
      <TopologyView
        topology={{ ...manualTopology, source: 'ikuai' }}
        services={[]}
        health={[]}
        networkMode="internal"
      />,
    );

    expect(await screen.findByText('iKuai 实时拓扑')).toBeInTheDocument();
    expect(screen.getByLabelText('iKuai 实时吞吐')).toHaveTextContent('18 台在线');
    fireEvent.click(screen.getByRole('button', { name: /iKuai 主路由/ }));
    expect(screen.getAllByText('192.0.2.1')).toHaveLength(2);
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('shows the saved manual graph and a clear notice when the API falls back', async () => {
    const fallback: TopologySnapshot = {
      requestedSource: 'ikuai',
      source: 'manual',
      status: 'fallback',
      message: 'iKuai Token 无效、已过期或权限不足，当前显示手工拓扑。',
      updatedAt: null,
      nodes: manualTopology.nodes,
      links: manualTopology.links,
    };
    vi.spyOn(api, 'getTopology').mockResolvedValue(fallback);

    render(
      <TopologyView
        topology={{ ...manualTopology, source: 'ikuai' }}
        services={[]}
        health={[]}
        networkMode="internal"
      />,
    );

    expect(await screen.findByText('手工拓扑回退')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Token 无效');
    expect(screen.getByRole('button', { name: /手工路由器/ })).toBeInTheDocument();
  });

  it('does not contact the iKuai endpoint in manual mode', async () => {
    const getTopology = vi.spyOn(api, 'getTopology');

    render(
      <TopologyView
        topology={manualTopology}
        services={[]}
        health={[]}
        networkMode="internal"
      />,
    );

    await waitFor(() => expect(screen.getByText('手工拓扑')).toBeInTheDocument());
    expect(getTopology).not.toHaveBeenCalled();
  });
});
