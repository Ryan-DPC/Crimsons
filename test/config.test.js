import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObsPathSecret } from '../lib/hoopslive-obs/config.js';

describe('resolveObsPathSecret', () => {
  it('prefers OBS_PATH_SECRET over HOOPSLIVE_OBS_PUBLIC_PATH_SECRET', () => {
    assert.equal(
      resolveObsPathSecret({
        OBS_PATH_SECRET: 'primary',
        HOOPSLIVE_OBS_PUBLIC_PATH_SECRET: 'fallback',
      }),
      'primary',
    );
  });

  it('falls back to HOOPSLIVE_OBS_PUBLIC_PATH_SECRET when primary empty', () => {
    assert.equal(
      resolveObsPathSecret({
        OBS_PATH_SECRET: '',
        HOOPSLIVE_OBS_PUBLIC_PATH_SECRET: 'fallback',
      }),
      'fallback',
    );
    assert.equal(
      resolveObsPathSecret({
        HOOPSLIVE_OBS_PUBLIC_PATH_SECRET: 'fallback-only',
      }),
      'fallback-only',
    );
  });

  it('returns empty string when neither is set', () => {
    assert.equal(resolveObsPathSecret({}), '');
  });
});
