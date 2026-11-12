export type SignInCredentials = { email: string; password: string } | { phone: string; password: string };

// Same Indian-mobile rule as the web normalizeIndianMobile, so a web-set app password matches the Auth phone.
export function signInCredentials(identifier: string, password: string): SignInCredentials | null {
  const value = identifier.trim();
  if (value.includes('@')) return { email: value.toLowerCase(), password };
  const compact = value.replace(/[\s()-]/g, '');
  const digits = compact.startsWith('+91') ? compact.slice(3) : compact.length === 12 && compact.startsWith('91') ? compact.slice(2) : compact;
  return /^[6-9]\d{9}$/.test(digits) ? { phone: `+91${digits}`, password } : null;
}
