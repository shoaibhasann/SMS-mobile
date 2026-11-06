export default { oxc: { jsx: { runtime: 'automatic' } }, test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' } } satisfies import('vitest/config').ViteUserConfig;
