export function formatBytes(value: number, decimals = 1): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} 小时 ${minutes} 分`;
}

export function clampPercent(value: number | undefined): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value! : 0));
}

export function statusLabel(status?: string): string {
  if (status === 'up') return '在线';
  if (status === 'down') return '离线';
  if (status === 'checking') return '检测中';
  return '未检测';
}
