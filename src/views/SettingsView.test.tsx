// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Service } from '../types';
import { SettingsView } from './SettingsView';

const config: AppConfig = {
  settings: {
    title: 'HomeLab',
    location: 'Home',
    hostDisplayName: '',
    refreshInterval: 5000,
  },
  services: [],
  topology: {
    source: 'manual',
    refreshInterval: 15_000,
    hosts: [],
    nodes: [],
    links: [],
  },
};

function service(overrides: Pick<Service, 'id' | 'name' | 'url' | 'scope' | 'runtime'>): Service {
  return {
    description: '',
    externalUrl: '',
    category: '测试',
    icon: 'default',
    iconUrl: '',
    iconAllowInsecureTls: false,
    favorite: false,
    check: { type: 'none' },
    ...overrides,
  };
}

const hostSelectionConfig: AppConfig = {
  ...config,
  services: [
    service({ id: 'esxi', name: 'VMware ESXi', url: 'https://esxi.home.arpa', scope: 'internal', runtime: 'infrastructure' }),
    service({ id: 'synology', name: 'Synology DSM', url: 'https://nas.home.arpa:5001', scope: 'internal', runtime: 'infrastructure' }),
    service({ id: 'vm', name: 'iStoreOS', url: 'http://vm.home.arpa', scope: 'internal', runtime: 'vm' }),
    service({ id: 'fnos', name: 'fnOS', url: 'http://fnos.home.arpa', scope: 'internal', runtime: 'vm' }),
    service({ id: 'docker', name: 'Immich', url: 'http://docker.home.arpa', scope: 'internal', runtime: 'docker' }),
    service({ id: 'cloud', name: 'Alibaba Cloud', url: 'https://cloud.example.com', scope: 'external', runtime: 'infrastructure' }),
  ],
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

  it('adds multiple generic hosts and assigns each workload to at most one host', async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <SettingsView
        config={hostSelectionConfig}
        saving={false}
        onSave={onSave}
      />,
    );

    const addHost = screen.getByRole('button', { name: '添加宿主' });
    fireEvent.click(addHost);
    fireEvent.click(addHost);

    const firstHostSelect = screen.getByRole('combobox', { name: '宿主 1 关联服务' }) as HTMLSelectElement;
    const secondHostSelect = screen.getByRole('combobox', { name: '宿主 2 关联服务' }) as HTMLSelectElement;
    expect(Array.from(firstHostSelect.options).map((option) => option.value)).toEqual(['esxi', 'synology', 'vm', 'fnos']);
    expect(Array.from(firstHostSelect.options).find((option) => option.value === 'synology')).toBeDisabled();
    expect(Array.from(secondHostSelect.options).find((option) => option.value === 'esxi')).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加宿主' })).toBeEnabled();

    fireEvent.change(screen.getByRole('combobox', { name: '宿主 2 节点样式' }), { target: { value: 'nas' } });
    fireEvent.click(screen.getAllByRole('checkbox', { name: /iStoreOS/ })[0]);
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Immich/ })[1]);
    fireEvent.click(screen.getByRole('button', { name: '保存拓扑设置' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      ...hostSelectionConfig,
      topology: {
        ...hostSelectionConfig.topology,
        hosts: [
          { serviceId: 'esxi', nodeType: 'server', serviceIds: ['vm'] },
          { serviceId: 'synology', nodeType: 'nas', serviceIds: ['docker'] },
        ],
      },
    }));
  });

  it('shows nested VM hosts and disables relationships that would create a cycle', () => {
    const nestedConfig: AppConfig = {
      ...hostSelectionConfig,
      topology: {
        ...hostSelectionConfig.topology,
        hosts: [
          { serviceId: 'esxi', nodeType: 'server', serviceIds: ['vm'] },
          { serviceId: 'vm', nodeType: 'server', serviceIds: ['fnos'] },
          { serviceId: 'fnos', nodeType: 'server', serviceIds: ['docker'] },
        ],
      },
    };

    render(
      <SettingsView
        config={nestedConfig}
        saving={false}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText('宿主 2 · VMware ESXi 下级')).toBeInTheDocument();
    expect(screen.getByText('宿主 3 · iStoreOS 下级')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '宿主 2 节点样式' })).toBeDisabled();
    const fnosHostWorkloads = screen.getByText('宿主 3 · iStoreOS 下级')
      .closest('fieldset')
      ?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const istoreosCheckbox = Array.from(fnosHostWorkloads ?? [])
      .find((checkbox) => checkbox.parentElement?.textContent?.includes('iStoreOS'));
    expect(istoreosCheckbox).toBeDisabled();
  });
});
