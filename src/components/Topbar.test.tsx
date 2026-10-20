// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { Topbar } from './Topbar';

describe('Topbar network mode switch', () => {
  it('exposes the selected mode and reports mode changes', () => {
    const onNetworkModeChange = vi.fn();
    const props = {
      view: 'services' as const,
      search: '',
      loading: false,
      connected: true,
      lastUpdated: '10:30',
      onSearch: vi.fn(),
      onNetworkModeChange,
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
});
