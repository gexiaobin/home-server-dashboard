import { describe, expect, it } from 'vitest';
import { getServiceIconUrl } from './service-icons';

describe('getServiceIconUrl', () => {
  it('uses only the service id without exposing the configured URL', () => {
    expect(getServiceIconUrl({
      id: 'home-assistant',
    })).toBe('/api/services/home-assistant/icon');
  });
});
