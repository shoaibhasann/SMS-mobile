import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getConfig } = require('expo/config');
const { getRoutes } = require('expo-router/build/getRoutesCore.js');

function topRoutes(options: object) {
  const files = readdirSync('src/app', { withFileTypes: true }).filter(f => f.isFile()).map(f => `./${f.name}`);
  const ctx = Object.assign(() => ({ default: () => null }), { keys: () => files, resolve: (k: string) => k, id: 'app' });
  const getSystemRoute = ({ route, type, defaults }: { route: string; type: string; defaults?: object }) =>
    ({ loadRoute: () => ({ default: () => null }), route, type, contextKey: `expo-router/build/views/${route}`, generated: true, internal: true, dynamic: null, children: [], ...defaults });
  return getRoutes(ctx, { ...options, platform: 'android', getSystemRoute }).children.map((c: { route: string }) => c.route);
}

it('ships without the Expo dev _sitemap route, so sms-school:///_sitemap is not reachable', () => {
  const router = getConfig(process.cwd(), { skipSDKVersionRequirement: true }).exp.extra.router;
  expect(router.sitemap).toBe(false);
  expect(topRoutes({})).toContain('_sitemap'); // control: expo-router's default would add it
  expect(topRoutes(router)).not.toContain('_sitemap');
  expect(topRoutes(router)).toContain('+not-found');
});
