import { describe, expect, it } from 'vitest';
import { signInCredentials } from '../src/auth/credentials';

describe('mobile sign-in identifier', () => {
  it('keeps email sign-in trimmed and lowercased', () => {
    expect(signInCredentials('  Guardian@School.Test ', 'pw')).toEqual({ email: 'guardian@school.test', password: 'pw' });
  });
  it.each(['98765 43210', '+91 98765-43210', '919876543210', '(987) 654-3210'])('accepts the verified Indian mobile %s', value => {
    expect(signInCredentials(value, 'pw')).toEqual({ phone: '+919876543210', password: 'pw' });
  });
  it.each(['12345 67890', '98765', 'guardian', '+1 415 555 0100'])('rejects %s', value => {
    expect(signInCredentials(value, 'pw')).toBeNull();
  });
});
