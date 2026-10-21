// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceDialog } from './ServiceDialog';

afterEach(cleanup);

function renderDialog(onSave = vi.fn(async () => {})) {
  render(
    <ServiceDialog
      service={null}
      categories={[]}
      open
      saving={false}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe('ServiceDialog', () => {
  it('saves separate internal and internet URLs without pinning an empty HTTP check', async () => {
    const onSave = renderDialog();

    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: ' Vaultwarden ' } });
    fireEvent.change(screen.getByLabelText('内网地址'), { target: { value: ' http://vault.home.arpa ' } });
    fireEvent.change(screen.getByLabelText('互联网地址（可选）'), { target: { value: ' https://vault.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'HTTP' }));
    fireEvent.click(screen.getByRole('button', { name: '保存服务' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Vaultwarden',
      url: 'http://vault.home.arpa',
      externalUrl: 'https://vault.example.com',
      check: { type: 'http' },
    }));
  });

  it('rejects an unsafe internet URL', async () => {
    const onSave = renderDialog();

    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: 'Vaultwarden' } });
    fireEvent.change(screen.getByLabelText('内网地址'), { target: { value: 'http://vault.home.arpa' } });
    fireEvent.change(screen.getByLabelText('互联网地址（可选）'), { target: { value: 'file:///etc/passwd' } });
    fireEvent.click(screen.getByRole('button', { name: '保存服务' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('互联网地址必须是完整的 http:// 或 https:// 地址。');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves an explicit insecure TLS opt-in for a trusted service icon', async () => {
    const onSave = renderDialog();

    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: 'Synology DSM' } });
    fireEvent.change(screen.getByLabelText('内网地址'), { target: { value: 'https://nas.home.arpa:5001' } });
    fireEvent.click(screen.getByLabelText('允许自签名 HTTPS 图标'));
    fireEvent.click(screen.getByRole('button', { name: '保存服务' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      iconAllowInsecureTls: true,
    }));
  });
});
