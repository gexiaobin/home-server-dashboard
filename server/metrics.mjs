import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PSEUDO_DISK_PATHS = new Set(['/proc', '/sys', '/dev']);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function parseCpuStat(text) {
  const lines = text.trim().split(/\r?\n/);
  const aggregate = lines.find((line) => /^cpu\s/.test(line));
  if (!aggregate) {
    throw new Error('CPU aggregate is missing from proc stat');
  }

  const values = aggregate.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('CPU aggregate in proc stat is invalid');
  }

  return {
    total: values.reduce((sum, value) => sum + value, 0),
    idle: values[3] + (values[4] || 0),
    cores: lines.filter((line) => /^cpu\d+\s/.test(line)).length,
  };
}

export function calculateCpuUsage(previous, current) {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) {
    return 0;
  }
  return round(clamp(((totalDelta - idleDelta) / totalDelta) * 100, 0, 100));
}

export function parseMeminfo(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s+(\d+)\s*(kB)?/);
    if (match) {
      values.set(match[1], Number(match[2]) * (match[3] ? 1024 : 1));
    }
  }

  const total = values.get('MemTotal');
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('MemTotal is missing from proc meminfo');
  }
  const available = values.get('MemAvailable')
    ?? ((values.get('MemFree') || 0) + (values.get('Buffers') || 0) + (values.get('Cached') || 0));
  const used = clamp(total - available, 0, total);

  return {
    used,
    total,
    percent: round((used / total) * 100),
  };
}

export function parseNetworkDev(text) {
  const interfaces = [];
  for (const line of text.split(/\r?\n/).slice(2)) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    const fields = line.slice(separator + 1).trim().split(/\s+/).map(Number);
    if (!name || fields.length < 9 || fields.some((value) => !Number.isFinite(value))) {
      continue;
    }
    interfaces.push({
      name,
      rxBytes: fields[0],
      txBytes: fields[8],
    });
  }
  return interfaces;
}

async function firstReadableDirectory(candidates, fsImpl, requiredChild = '') {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await fsImpl.access(requiredChild ? path.join(candidate, requiredChild) : candidate);
      return candidate;
    } catch {
      // Try the container-native path next.
    }
  }
  throw new Error(`None of these paths are readable: ${candidates.filter(Boolean).join(', ')}`);
}

async function readNumber(filePath, fsImpl) {
  const raw = await fsImpl.readFile(filePath, 'utf8');
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value in ${filePath}`);
  }
  return value;
}

export async function readTemperatures(sysRoot, fsImpl = fs) {
  const temperatures = [];
  const thermalRoot = path.join(sysRoot, 'class/thermal');

  try {
    const entries = await fsImpl.readdir(thermalRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('thermal_zone')) {
        continue;
      }
      const zonePath = path.join(thermalRoot, entry.name);
      try {
        const [rawValue, rawLabel] = await Promise.all([
          readNumber(path.join(zonePath, 'temp'), fsImpl),
          fsImpl.readFile(path.join(zonePath, 'type'), 'utf8').catch(() => entry.name),
        ]);
        const value = Math.abs(rawValue) >= 1000 ? rawValue / 1000 : rawValue;
        if (value > -100 && value < 250) {
          temperatures.push({ label: rawLabel.trim(), value: round(value) });
        }
      } catch {
        // A single unreadable sensor should not hide other sensors.
      }
    }
  } catch {
    // Thermal zones are optional in containers and on many NAS kernels.
  }

  if (temperatures.length > 0) {
    return temperatures;
  }

  const hwmonRoot = path.join(sysRoot, 'class/hwmon');
  try {
    const devices = await fsImpl.readdir(hwmonRoot, { withFileTypes: true });
    for (const device of devices) {
      if (!device.isDirectory()) {
        continue;
      }
      const devicePath = path.join(hwmonRoot, device.name);
      const files = await fsImpl.readdir(devicePath);
      const deviceName = (await fsImpl.readFile(path.join(devicePath, 'name'), 'utf8').catch(() => device.name)).trim();
      for (const fileName of files.filter((name) => /^temp\d+_input$/.test(name))) {
        const sensor = fileName.match(/^temp(\d+)_input$/)?.[1];
        try {
          const rawValue = await readNumber(path.join(devicePath, fileName), fsImpl);
          const label = (await fsImpl.readFile(path.join(devicePath, `temp${sensor}_label`), 'utf8')
            .catch(() => `${deviceName} ${sensor}`)).trim();
          const value = Math.abs(rawValue) >= 1000 ? rawValue / 1000 : rawValue;
          if (value > -100 && value < 250) {
            temperatures.push({ label, value: round(value) });
          }
        } catch {
          // Continue with the next sensor.
        }
      }
    }
  } catch {
    // hwmon is optional.
  }

  return temperatures;
}

export async function readDiskMetrics(diskPaths, fsImpl = fs) {
  const disks = [];
  const uniquePaths = [...new Set(diskPaths.filter(Boolean))];
  for (const mount of uniquePaths) {
    if (PSEUDO_DISK_PATHS.has(mount)) {
      continue;
    }
    try {
      const stats = await fsImpl.statfs(mount);
      const blockSize = Number(stats.bsize);
      const total = Number(stats.blocks) * blockSize;
      const free = Number(stats.bfree) * blockSize;
      const used = clamp(total - free, 0, total);
      if (!Number.isFinite(total) || total <= 0) {
        continue;
      }
      disks.push({
        mount,
        used,
        total,
        percent: round((used / total) * 100),
      });
    } catch {
      // Optional mounts such as /data may not exist during local development.
    }
  }
  return disks;
}

function configuredDiskPaths(explicitPaths) {
  if (explicitPaths) {
    return explicitPaths;
  }
  const paths = [];
  if (process.env.HOST_STORAGE) {
    paths.push(process.env.HOST_STORAGE);
  }
  if (process.env.DISK_PATHS) {
    paths.push(...process.env.DISK_PATHS.split(',').map((item) => item.trim()).filter(Boolean));
  }
  paths.push('/data', '/');
  return paths;
}

function readOsCpuSnapshot(osImpl) {
  const cpus = osImpl.cpus();
  let total = 0;
  let idle = 0;
  for (const cpu of cpus) {
    const times = Object.values(cpu.times || {}).map(Number).filter(Number.isFinite);
    total += times.reduce((sum, value) => sum + value, 0);
    idle += Number(cpu.times?.idle || 0);
  }
  return { total, idle, cores: cpus.length };
}

export class MetricsCollector {
  constructor({
    procRoot,
    sysRoot,
    diskPaths,
    hostDisplayName,
    fsImpl = fs,
    osImpl = os,
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    sampleIntervalMs = 100,
  } = {}) {
    this.procRoot = procRoot;
    this.sysRoot = sysRoot;
    this.diskPaths = configuredDiskPaths(diskPaths);
    this.hostDisplayName = typeof hostDisplayName === 'string' && hostDisplayName.trim()
      ? hostDisplayName.trim()
      : null;
    this.fs = fsImpl;
    this.os = osImpl;
    this.now = now;
    this.sleep = sleep;
    this.sampleIntervalMs = sampleIntervalMs;
    this.previousCpu = null;
    this.previousNetwork = null;
    this.resolvedProcRoot = undefined;
    this.resolvedSysRoot = undefined;
  }

  async resolveRoots() {
    if (this.resolvedProcRoot === undefined) {
      try {
        this.resolvedProcRoot = await firstReadableDirectory([
          this.procRoot,
          process.env.HOST_PROC,
          '/host/proc',
        '/proc',
      ], this.fs, 'stat');
      } catch {
        this.resolvedProcRoot = null;
      }
    }
    if (this.resolvedSysRoot === undefined) {
      const derivedHostSys = this.resolvedProcRoot === '/host/proc' ? '/host/sys' : null;
      try {
        this.resolvedSysRoot = await firstReadableDirectory([
          this.sysRoot,
          process.env.HOST_SYS,
          derivedHostSys,
          '/sys',
        ], this.fs);
      } catch {
        this.resolvedSysRoot = null;
      }
    }
  }

  async readCpu() {
    if (!this.resolvedProcRoot) {
      return readOsCpuSnapshot(this.os);
    }
    const raw = await this.fs.readFile(path.join(this.resolvedProcRoot, 'stat'), 'utf8');
    return parseCpuStat(raw);
  }

  async collect() {
    await this.resolveRoots();
    let currentCpu = await this.readCpu();
    let cpuUsage;
    if (!this.previousCpu && this.sampleIntervalMs > 0) {
      await this.sleep(this.sampleIntervalMs);
      const sampledCpu = await this.readCpu();
      cpuUsage = calculateCpuUsage(currentCpu, sampledCpu);
      currentCpu = sampledCpu;
    } else {
      cpuUsage = this.previousCpu ? calculateCpuUsage(this.previousCpu, currentCpu) : 0;
    }
    this.previousCpu = currentCpu;

    const [meminfo, networkText, disks, temperatures] = await Promise.all([
      this.resolvedProcRoot
        ? this.fs.readFile(path.join(this.resolvedProcRoot, 'meminfo'), 'utf8')
        : null,
      this.resolvedProcRoot
        ? this.fs.readFile(path.join(this.resolvedProcRoot, 'net/dev'), 'utf8')
        : null,
      readDiskMetrics(this.diskPaths, this.fs),
      this.resolvedSysRoot ? readTemperatures(this.resolvedSysRoot, this.fs) : [],
    ]);

    const interfaces = networkText ? parseNetworkDev(networkText) : [];
    const now = Number(this.now());
    let rxBytesPerSecond = 0;
    let txBytesPerSecond = 0;
    if (this.previousNetwork && now > this.previousNetwork.time) {
      const elapsedSeconds = (now - this.previousNetwork.time) / 1000;
      const previousByName = new Map(this.previousNetwork.interfaces.map((item) => [item.name, item]));
      for (const current of interfaces) {
        if (current.name === 'lo') {
          continue;
        }
        const previous = previousByName.get(current.name);
        if (!previous) {
          continue;
        }
        rxBytesPerSecond += Math.max(0, current.rxBytes - previous.rxBytes) / elapsedSeconds;
        txBytesPerSecond += Math.max(0, current.txBytes - previous.txBytes) / elapsedSeconds;
      }
    }
    this.previousNetwork = { time: now, interfaces };

    return {
      system: {
        hostname: this.hostDisplayName || this.os.hostname(),
        platform: this.os.platform(),
        uptime: this.os.uptime(),
        loadAverage: this.os.loadavg(),
      },
      cpu: {
        usage: cpuUsage,
        cores: currentCpu.cores || this.os.cpus().length,
      },
      memory: meminfo
        ? parseMeminfo(meminfo)
        : (() => {
            const total = this.os.totalmem();
            const used = clamp(total - this.os.freemem(), 0, total);
            return { used, total, percent: total > 0 ? round((used / total) * 100) : 0 };
          })(),
      disks,
      network: {
        rxBytesPerSecond: Math.round(rxBytesPerSecond),
        txBytesPerSecond: Math.round(txBytesPerSecond),
        interfaces,
      },
      temperatures,
    };
  }
}

export async function readSystemMetrics(options = {}) {
  const collector = new MetricsCollector(options);
  return collector.collect();
}
