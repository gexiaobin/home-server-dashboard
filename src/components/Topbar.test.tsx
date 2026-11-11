// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Topbar } from './Topbar';

afterEach(cleanup);

describe('Topbar network mode switch', () => {
  it('exposes the selected mode and reports mode changes', () => {
    const onNetworkModeChange = vi.fn();
    const props = {
      view: 'services' as const,
      search: '',
      loading: false,
      connected: true,
      theme: 'dark' as const,
      lastUpdated: '10:30',
      onSearch: vi.fn(),
      onNetworkModeChange,
      onThemeChange: vi.fn(),
      onRefresh: vi.fn(),
      onOpenMenu: vi.fn(),
    };
    const { rerender } = render(<Topbar {...props} networkMode="internal" />);

    const internal = screen.getByRole('button', { name: '内网' });
    const external = screen.getByRole('button', { name: '外网' });
    expect(screen.getByRole('group', { name: '访问网络' })).toBeInTheDocument();
    expect(internal).toHaveAttribute('aria-pressed', 'true');
    expect(external).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(external);
    expect(onNetworkModeChange).toHaveBeenCalledWith('external');

    rerender(<Topbar {...props} networkMode="external" />);
    expect(internal).toHaveAttribute('aria-pressed', 'false');
    expect(external).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches between dark and light themes', () => {
    const onThemeChange = vi.fn();
    const props = {
      view: 'overview' as const,
      search: '',
      loading: false,
      connected: true,
      lastUpdated: '10:30',
      networkMode: 'internal' as const,
      onSearch: vi.fn(),
      onNetworkModeChange: vi.fn(),
      onThemeChange,
      onRefresh: vi.fn(),
      onOpenMenu: vi.fn(),
    };
    const { rerender } = render(<Topbar {...props} theme="dark" />);

    fireEvent.click(screen.getByRole('button', { name: '切换为明亮主题' }));
    expect(onThemeChange).toHaveBeenCalledWith('light');

    rerender(<Topbar {...props} theme="light" />);
    expect(screen.getByRole('button', { name: '切换为暗色主题' })).toHaveAttribute('aria-pressed', 'true');
  });
});
