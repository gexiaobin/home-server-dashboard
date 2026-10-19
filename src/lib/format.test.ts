import { describe, expect, it } from 'vitest';
import { clampPercent, formatBytes, formatRate, formatUptime, statusLabel } from './format';

describe('format helpers', () => {
  it('formats byte values and rates', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatRate(1024 * 1024)).toBe('1.0 MB/s');
  });

  it('formats uptime for short and long periods', () => {
    expect(formatUptime(3660)).toBe('1 小时 1 分');
    expect(formatUptime(90000)).toBe('1 天 1 小时');
  });

  it('clamps percentages and localizes statuses', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(120)).toBe(100);
    expect(statusLabel('up')).toBe('在线');
    expect(statusLabel('anything-else')).toBe('未检测');
  });
});
