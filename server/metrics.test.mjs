import { describe, expect, it, vi } from 'vitest';

import {
  calculateCpuUsage,
  MetricsCollector,
  parseCpuStat,
  parseMeminfo,
  parseNetworkDev,
  readDiskMetrics,
  readSystemMetrics,
} from './metrics.mjs';

function networkFixture(rxBytes, txBytes) {
  return [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    `  eth0: ${rxBytes} 1 0 0 0 0 0 0 ${txBytes} 1 0 0 0 0 0 0`,
    '    lo: 50 1 0 0 0 0 0 0 50 1 0 0 0 0 0 0',
  ].join('\n');
}

function createFixtureFs({ hostName } = {}) {
  const cpuSamples = [
    'cpu  100 0 0 900 0\ncpu0 50 0 0 450 0\ncpu1 50 0 0 450 0\n',
    'cpu  180 0 0 920 0\ncpu0 90 0 0 460 0\ncpu1 90 0 0 460 0\n',
  ];
  const networkSamples = [networkFixture(1_000, 2_000), networkFixture(1_600, 2_400)];
  let cpuIndex = 0;
  let networkIndex = 0;

  return {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async (filePath) => {
      if (filePath.endsWith('/stat')) {
        return cpuSamples[Math.min(cpuIndex++, cpuSamples.length - 1)];
      }
      if (filePath.endsWith('/meminfo')) {
        return 'MemTotal: 1000 kB\nMemAvailable: 250 kB\n';
      }
      if (filePath.endsWith('/net/dev')) {
        return networkSamples[Math.min(networkIndex++, networkSamples.length - 1)];
      }
      if (filePath.endsWith('/sys/kernel/hostname') && hostName) {
        return `${hostName}\n`;
      }
      throw Object.assign(new Error(`Unexpected read: ${filePath}`), { code: 'ENOENT' });
    }),
    readdir: vi.fn(async () => {
      throw Object.assign(new Error('No sensors'), { code: 'ENOENT' });
    }),
    statfs: vi.fn(async () => ({ bsize: 1_024, blocks: 1_000, bfree: 250 })),
  };
}

const osFixture = {
  hostname: () => 'nas-test',
  platform: () => 'linux',
  uptime: () => 1234,
  loadavg: () => [0.1, 0.2, 0.3],
  cpus: () => [{}, {}],
};

describe('metric parsers', () => {
  it('parses aggregate CPU counters and calculates bounded usage', () => {
    const parsed = parseCpuStat('cpu  100 10 20 300 40 5 6 7\ncpu0 50 5 10 150 20\ncpu1 50 5 10 150 20\n');

    expect(parsed).toEqual({ total: 488, idle: 340, cores: 2 });
    expect(calculateCpuUsage({ total: 100, idle: 80 }, { total: 200, idle: 130 })).toBe(50);
    expect(calculateCpuUsage({ total: 200, idle: 130 }, { total: 200, idle: 130 })).toBe(0);
  });

  it('parses memory and per-interface network counters', () => {
    expect(parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\n')).toEqual({
      used: 750 * 1024,
      total: 1000 * 1024,
      percent: 75,
    });
    expect(parseNetworkDev(networkFixture(1_000, 2_000))).toEqual([
      { name: 'eth0', rxBytes: 1_000, txBytes: 2_000 },
      { name: 'lo', rxBytes: 50, txBytes: 50 },
    ]);
  });

  it('collects every distinct readable storage mount', async () => {
    const fsImpl = {
      stat: vi.fn(async (mount) => ({ dev: mount.endsWith('volume2') ? 2 : 1 })),
      statfs: vi.fn(async (mount) => mount.endsWith('volume2')
        ? { bsize: 1024, blocks: 2000, bfree: 500 }
        : { bsize: 1024, blocks: 1000, bfree: 250 }),
    };

    await expect(readDiskMetrics([
      '/host/storage',
      '/host/storage-alias',
      '/host/storage/volume2',
      '/host/storage',
    ], fsImpl)).resolves.toEqual([
      { mount: '/host/storage', used: 750 * 1024, total: 1000 * 1024, percent: 75 },
      { mount: '/host/storage/volume2', used: 1500 * 1024, total: 2000 * 1024, percent: 75 },
    ]);
    expect(fsImpl.statfs).toHaveBeenCalledTimes(2);
  });
});

describe('MetricsCollector', () => {
  it('uses injected proc/sys sources and calculates rates across samples', async () => {
    const fsImpl = createFixtureFs();
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(3_000);
    const collector = new MetricsCollector({
      procRoot: '/fixture/proc',
      sysRoot: '/fixture/sys',
      diskPaths: ['/fixture/storage'],
      fsImpl,
      osImpl: osFixture,
      now,
      sampleIntervalMs: 0,
    });

    const first = await collector.collect();
    const second = await collector.collect();

    expect(first).toMatchObject({
      system: { hostname: 'nas-test', platform: 'linux', uptime: 1234 },
      cpu: { usage: 0, cores: 2 },
      memory: { used: 750 * 1024, total: 1000 * 1024, percent: 75 },
      disks: [{ mount: '/fixture/storage', used: 750 * 1024, total: 1000 * 1024, percent: 75 }],
      network: { rxBytesPerSecond: 0, txBytesPerSecond: 0 },
      temperatures: [],
    });
    expect(second.cpu.usage).toBe(80);
    expect(second.network).toMatchObject({
      rxBytesPerSecond: 300,
      txBytesPerSecond: 200,
    });
  });

  it('exposes one-shot collection through readSystemMetrics', async () => {
    const result = await readSystemMetrics({
      procRoot: '/fixture/proc',
      sysRoot: '/fixture/sys',
      diskPaths: [],
      fsImpl: createFixtureFs(),
      osImpl: osFixture,
      now: () => 1_000,
      sampleIntervalMs: 0,
    });

    expect(result).toMatchObject({
      system: { hostname: 'nas-test' },
      cpu: { usage: 0, cores: 2 },
      memory: { percent: 75 },
    });
  });

  it('reads the host hostname from the mounted proc tree', async () => {
    const result = await readSystemMetrics({
      procRoot: '/fixture/proc',
      sysRoot: '/fixture/sys',
      diskPaths: [],
      fsImpl: createFixtureFs({ hostName: 'DiskStation' }),
      osImpl: osFixture,
      now: () => 1_000,
      sampleIntervalMs: 0,
    });

    expect(result.system.hostname).toBe('DiskStation');
  });

  it('falls back to the runtime hostname when host proc does not expose one', async () => {
    const result = await readSystemMetrics({
      procRoot: '/fixture/proc',
      sysRoot: '/fixture/sys',
      diskPaths: [],
      fsImpl: createFixtureFs(),
      osImpl: osFixture,
      now: () => 1_000,
      sampleIntervalMs: 0,
    });

    expect(result.system.hostname).toBe('nas-test');
  });
});
