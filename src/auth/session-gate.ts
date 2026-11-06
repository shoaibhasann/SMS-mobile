type Transition = 'signIn' | 'signOut' | 'role' | 'authLoss';

export class SessionTransitionError extends Error {
  constructor(readonly code: 'busy' | 'cleanup') {
    super(code === 'busy' ? 'An account change is already in progress.' : 'Sign out to finish securing this phone before changing accounts.');
  }
}

export function createSessionGate() {
  let epoch = 0, running = false, blocked = false;
  return {
    get running() { return running; },
    get blocked() { return blocked; },
    invalidate() { epoch++; },
    beginRead() {
      if (running || blocked) return null;
      const request = ++epoch;
      return () => request === epoch && !running && !blocked;
    },
    async run<T>(transition: Transition, work: () => Promise<T>): Promise<T> {
      if (running) throw new SessionTransitionError('busy');
      if (blocked && transition !== 'signOut' && transition !== 'authLoss') throw new SessionTransitionError('cleanup');
      running = true; epoch++;
      try {
        const value = await work();
        blocked = false;
        return value;
      } catch (error) {
        blocked = transition !== 'signIn';
        throw error;
      } finally {
        running = false; epoch++;
      }
    },
  };
}
