// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { AppConfig, Service, TopologySnapshot } from '../types';
import { TopologyView } from './TopologyView';

const services: Service[] = [
  {
    id: 'vmware-esxi',
    name: 'VMware ESXi',
    description: 'Virtualization host',
    url: 'https://192.0.2.254/ui',
    externalUrl: '',
    scope: 'internal',
    runtime: 'infrastructure',
    category: '基础设施',
    icon: 'boxes',
    iconUrl: '',
    iconAllowInsecureTls: false,
    favorite: false,
    check: { type: 'none' },
  },
  {
    id: 'synology-dsm',
    name: 'Synology DS920+',
    description: 'Docker host',
    url: 'https://192.0.2.8:5001',
    externalUrl: '',
    scope: 'internal',
    runtime: 'infrastructure',
    category: '基础设施',
    icon: 'server',
    iconUrl: '',
    iconAllowInsecureTls: false,
    favorite: false,
    check: { type: 'none' },
  },
  {
    id: 'istoreos',
    name: 'iStoreOS',
    description: 'Router VM',
    url: 'http://192.0.2.2',
    externalUrl: '',
    scope: 'internal',
    runtime: 'vm',
    category: '网络',
    icon: 'network',
    iconUrl: '',
    iconAllowInsecureTls: false,
    favorite: false,
    check: { type: 'none' },
  },
  {
    id: 'qinglong',
    name: 'Qinglong',
    description: 'Automation',
    url: 'http://192.0.2.8:8903',
    externalUrl: '',
    scope: 'internal',
    runtime: 'docker',
    category: '自动化',
    icon: 'default',
    iconUrl: '',
    iconAllowInsecureTls: false,
    favorite: false,
    check: { type: 'none' },
  },
  {
    id: 'aliyun',
    name: 'Alibaba Cloud',
    description: 'Cloud bookmark',
    url: 'https://home.console.aliyun.com/',
    externalUrl: '',
    scope: 'external',
    runtime: 'infrastructure',
    category: '云服务',
    icon: 'default',
    iconUrl: '',
    iconAllowInsecureTls: false,
    favorite: false,
    check: { type: 'none' },
  },
];

const manualTopology: AppConfig['topology'] = {
  source: 'manual',
  refreshInterval: 15_000,
  hosts: [
    { serviceId: 'vmware-esxi', nodeType: 'server', serviceIds: ['istoreos'] },
    { serviceId: 'synology-dsm', nodeType: 'nas', serviceIds: ['qinglong'] },
  ],
  nodes: [],
  links: [],
};

const managedNodes: TopologySnapshot['nodes'] = [
  { id: 'managed-internet', label: 'Internet', type: 'internet', status: 'up', x: 50, y: 7 },
  {
    id: 'managed-router',
    label: 'iKuai',
    type: 'router',
    status: 'up',
    x: 50,
    y: 24,
    ipAddress: '192.0.2.1',
    cpuUsage: 12,
  },
  { id: 'managed-vm-host', label: 'VMware ESXi', type: 'server', serviceId: 'vmware-esxi', x: 27, y: 49 },
  { id: 'managed-docker-host', label: 'Synology DS920+', type: 'nas', serviceId: 'synology-dsm', x: 73, y: 49 },
  { id: 'managed-service-istoreos', label: 'iStoreOS', type: 'vm', serviceId: 'istoreos', x: 27, y: 80 },
  { id: 'managed-service-qinglong', label: 'Qinglong', type: 'container', serviceId: 'qinglong', x: 73, y: 80 },
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

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
  it('renders the managed iKuai tree, traffic, and only classified internal services', async () => {
    const snapshot: TopologySnapshot = {
      requestedSource: 'ikuai',
      source: 'ikuai',
      status: 'live',
      updatedAt: '2026-10-21T12:00:00.000Z',
      nodes: [
        ...managedNodes,
        { id: 'raw-client', label: 'Unmanaged phone', type: 'client', x: 10, y: 90 },
      ],
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

    const { container } = render(
      <TopologyView
        topology={{ ...manualTopology, source: 'ikuai' }}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );

    expect(await screen.findByText('iKuai 实时数据')).toBeInTheDocument();
    expect(screen.getByLabelText('iKuai 实时吞吐')).toHaveTextContent('路由在线终端 18 台');
    expect(screen.getByRole('button', { name: /iStoreOS/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Qinglong/ })).toBeInTheDocument();
    expect(screen.queryByText('Alibaba Cloud')).not.toBeInTheDocument();
    expect(screen.queryByText('Unmanaged phone')).not.toBeInTheDocument();
    expect(container.querySelector('img[src="/api/services/istoreos/icon"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /iKuai/ }));
    expect(screen.getAllByText('192.0.2.1')).toHaveLength(2);
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('shows the managed fallback graph and a clear notice when iKuai is unavailable', async () => {
    const fallbackNodes = managedNodes.map((node) => (
      node.type === 'router' ? { ...node, status: 'unknown' as const } : node
    ));
    const fallback: TopologySnapshot = {
      requestedSource: 'ikuai',
      source: 'manual',
      status: 'fallback',
      message: 'iKuai Token 无效、已过期或权限不足，当前显示已登记服务。',
      updatedAt: null,
      nodes: fallbackNodes,
      links: [],
    };
    vi.spyOn(api, 'getTopology').mockResolvedValue(fallback);

    render(
      <TopologyView
        topology={{ ...manualTopology, source: 'ikuai' }}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );

    expect(await screen.findByText('iKuai 暂不可用')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Token 无效');
    expect(screen.getByRole('button', { name: /VMware ESXi/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iKuai/ }).querySelector('.status-dot')).toHaveClass('is-unknown');
  });

  it('marks the router unknown when the topology request itself fails', async () => {
    vi.spyOn(api, 'getTopology').mockRejectedValue(new Error('Network error'));

    render(
      <TopologyView
        topology={{ ...manualTopology, source: 'ikuai' }}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Network error');
    expect(screen.getByRole('button', { name: /iKuai/ }).querySelector('.status-dot')).toHaveClass('is-unknown');
  });

  it('builds the service-directory tree without contacting iKuai in manual mode', async () => {
    const getTopology = vi.spyOn(api, 'getTopology');

    render(
      <TopologyView
        topology={manualTopology}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );

    await waitFor(() => expect(screen.getByText('服务目录拓扑')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /iStoreOS/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Qinglong/ })).toBeInTheDocument();
    expect(screen.queryByText('Alibaba Cloud')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iKuai/ }).querySelector('.status-dot')).toHaveClass('is-unknown');
    expect(getTopology).not.toHaveBeenCalled();
  });

  it('clears a manual refresh spinner when a newer silent refresh completes', async () => {
    const snapshot: TopologySnapshot = {
      requestedSource: 'ikuai',
      source: 'ikuai',
      status: 'live',
      updatedAt: '2026-10-21T12:00:00.000Z',
      nodes: managedNodes,
      links: [],
    };
    const manualRefresh = deferred<TopologySnapshot>();
    const silentRefresh = deferred<TopologySnapshot>();
    const getTopology = vi.spyOn(api, 'getTopology')
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(() => manualRefresh.promise)
      .mockImplementationOnce(() => silentRefresh.promise);
    const ikuaiTopology = { ...manualTopology, source: 'ikuai' as const };
    const { rerender } = render(
      <TopologyView
        topology={ikuaiTopology}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );

    expect(await screen.findByText('iKuai 实时数据')).toBeInTheDocument();
    const refreshButton = screen.getByRole('button', { name: '刷新拓扑' });
    fireEvent.click(refreshButton);
    expect(refreshButton.querySelector('svg')).toHaveClass('spin');

    rerender(
      <TopologyView
        topology={{ ...ikuaiTopology, refreshInterval: 30_000 }}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );
    await waitFor(() => expect(getTopology).toHaveBeenCalledTimes(3));

    await act(async () => {
      manualRefresh.resolve(snapshot);
      await Promise.resolve();
    });
    expect(refreshButton.querySelector('svg')).toHaveClass('spin');

    await act(async () => {
      silentRefresh.resolve(snapshot);
      await Promise.resolve();
    });
    await waitFor(() => expect(refreshButton.querySelector('svg')).not.toHaveClass('spin'));
  });

  it('ignores invalid host references while keeping the referenced VM as one leaf', async () => {
    render(
      <TopologyView
        topology={{
          ...manualTopology,
          hosts: [
            { serviceId: 'istoreos', nodeType: 'server', serviceIds: ['istoreos'] },
            { serviceId: 'aliyun', nodeType: 'nas', serviceIds: ['qinglong'] },
          ],
        }}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );

    await waitFor(() => expect(screen.getByText('服务目录拓扑')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /iStoreOS/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /未分配虚拟机/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /未分配 Docker 应用/ })).toBeInTheDocument();
    expect(screen.queryByText('Alibaba Cloud')).not.toBeInTheDocument();
  });

  it('does not attach a duplicated host service to both branches', async () => {
    const { container } = render(
      <TopologyView
        topology={{
          ...manualTopology,
          hosts: [
            { serviceId: 'vmware-esxi', nodeType: 'server', serviceIds: ['istoreos'] },
            { serviceId: 'vmware-esxi', nodeType: 'nas', serviceIds: ['qinglong'] },
          ],
        }}
        services={services}
        health={[]}
        networkMode="internal"
      />,
    );

    await waitFor(() => expect(screen.getByText('服务目录拓扑')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /^VMware ESXi/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /未分配 Docker 应用/ })).toBeInTheDocument();
    expect(container.querySelectorAll('img[src="/api/services/vmware-esxi/icon"]')).toHaveLength(1);
  });
});
