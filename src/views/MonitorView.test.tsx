// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MetricPoint, Overview } from '../types';
import { MonitorView } from './MonitorView';

const GIB = 1024 ** 3;

const overview: Overview = {
  timestamp: '2026-10-21T07:17:00.000Z',
  system: {
    hostname: 'Synology DS920+',
    platform: 'linux',
    uptime: 3600 * 26,
    loadAverage: [2, 1, 0.5],
  },
  cpu: { usage: 32, cores: 4 },
  memory: { used: 4 * GIB, total: 16 * GIB, percent: 25 },
  disks: [
    { mount: '/', used: 4 * GIB, total: 8 * GIB, percent: 50 },
    { mount: '/volume2', used: 6 * GIB, total: 12 * GIB, percent: 50 },
  ],
  network: {
    rxBytesPerSecond: 2048,
    txBytesPerSecond: 1024,
    interfaces: [{ name: 'eth0', rxBytes: 100, txBytes: 50 }],
  },
  temperatures: [
    { label: 'System', value: 42 },
    { label: 'CPU', value: 58 },
  ],
  services: [],
  containers: [
    { id: '1', name: 'dashboard', image: 'ghcr.io/example/dashboard:latest', state: 'running', status: 'Up 2 hours' },
    { id: '2', name: 'worker', image: 'example/worker:latest', state: 'paused', status: 'Paused' },
  ],
  containersAvailable: true,
};

const history: MetricPoint[] = [
  { time: '15:16:00', cpu: 20, memory: 24, rx: 0.2, tx: 0.1 },
  { time: '15:17:00', cpu: 32, memory: 25, rx: 0.4, tx: 0.2 },
];

beforeAll(() => {
  class ResizeObserverStub implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{
        target,
        contentRect: { width: 800, height: 400 } as DOMRectReadOnly,
      } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(cleanup);

describe('MonitorView', () => {
  it('presents load averages as labelled core-capacity percentages', () => {
    render(<MonitorView overview={overview} history={history} />);

    expect(screen.getByRole('heading', { name: '系统运行概况' })).toBeInTheDocument();
    expect(screen.getAllByText('Synology DS920+').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar', { name: '1 分钟系统负载' }))
      .toHaveAttribute('aria-valuetext', '50% 核心容量');
    expect(screen.getByRole('progressbar', { name: '5 分钟系统负载' }))
      .toHaveAttribute('aria-valuetext', '25% 核心容量');
    expect(screen.getByText('50% · 2.00')).toBeInTheDocument();
  });

  it('uses the largest storage volume and hottest temperature sensor', () => {
    render(<MonitorView overview={overview} history={history} />);

    const storageCard = screen.getByRole('article', { name: '存储空间 50%' });
    expect(within(storageCard).getByText('/volume2')).toBeInTheDocument();

    const temperatureCard = screen.getByRole('article', { name: '系统温度 58°C' });
    expect(within(temperatureCard).getByText('CPU')).toBeInTheDocument();
    expect(within(temperatureCard).getByText('2 个可用')).toBeInTheDocument();
    expect(within(temperatureCard).getByRole('progressbar', { name: '系统温度' }))
      .toHaveAttribute('aria-valuetext', '58°C');
  });

  it('renders every visible Docker container and distinguishes its state', () => {
    render(<MonitorView overview={overview} history={history} />);

    const list = screen.getByRole('list', { name: 'Docker 容器' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('dashboard')).toBeInTheDocument();
    expect(within(list).getByText('运行中')).toBeInTheDocument();
    expect(within(list).getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.container-count b' })).toBeInTheDocument();
  });

  it('keeps missing sensors and Docker access explicit', () => {
    render(<MonitorView overview={{
      ...overview,
      disks: [],
      temperatures: [],
      containers: [],
      containersAvailable: false,
    }} history={[]} />);

    expect(screen.getByRole('article', { name: '存储空间 --' })).toHaveTextContent('未挂载存储卷');
    expect(screen.getByRole('article', { name: '系统温度 --' })).toHaveTextContent('传感器不可用');
    expect(within(screen.getByRole('article', { name: '系统温度 --' })).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Docker 数据不可用')).toBeInTheDocument();
    expect(screen.getByText('正在积累趋势样本')).toBeInTheDocument();
  });

  it('distinguishes a connected Docker source with zero containers', () => {
    render(<MonitorView overview={{ ...overview, containers: [] }} history={history} />);

    expect(screen.getByText('暂无可见容器')).toBeInTheDocument();
    expect(screen.getByText('Docker 数据源已连接，当前未发现容器。')).toBeInTheDocument();
    expect(screen.queryByText('Docker 数据不可用')).not.toBeInTheDocument();
  });

  it('keeps overload percentages above 100 visible while clamping the meter', () => {
    render(<MonitorView overview={{
      ...overview,
      system: { ...overview.system, loadAverage: [8, 1, 0.5] },
    }} history={history} connected={false} />);

    expect(screen.getByText('200% · 8.00')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '1 分钟系统负载' }))
      .toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: '1 分钟系统负载' }))
      .toHaveAttribute('aria-valuetext', '200% 核心容量');
    expect(screen.getByText('连接中断，显示最近采样')).toBeInTheDocument();
  });
});
