// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../types';
import { SettingsView } from './SettingsView';

const config: AppConfig = {
  settings: {
    title: 'HomeLab',
    location: 'Home',
    hostDisplayName: '',
    refreshInterval: 5000,
  },
  services: [],
  topology: { source: 'manual', refreshInterval: 15_000, nodes: [], links: [] },
};

afterEach(cleanup);

describe('SettingsView', () => {
  it('uses the detected hostname as guidance and persists a friendly display name', async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <SettingsView
        config={config}
        detectedHostname="DiskStation"
        saving={false}
        onSave={onSave}
      />,
    );

    const input = screen.getByRole('textbox', { name: '主机显示名称' });
    expect(input).toHaveAttribute('placeholder', 'DiskStation');

    fireEvent.change(input, { target: { value: 'Synology DS920+' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      ...config,
      settings: { ...config.settings, hostDisplayName: 'Synology DS920+' },
    }));
  });

  it('persists only the topology source and refresh interval from the browser', async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <SettingsView
        config={config}
        detectedHostname="DiskStation"
        saving={false}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '拓扑数据源' }), {
      target: { value: 'ikuai' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '拓扑刷新间隔' }), {
      target: { value: '30000' },
    });
    expect(screen.getByText(/地址与 Token 仅从服务端部署环境读取/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存拓扑设置' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      ...config,
      topology: { ...config.topology, source: 'ikuai', refreshInterval: 30_000 },
    }));
  });
});
