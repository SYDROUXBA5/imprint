import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// waitFor / findBy give up after 1 s by default. A loaded CI runner can take longer to settle a screen,
// which failed correct tests at random; this only lengthens the wait, a passing check still returns at once.
configure({ asyncUtilTimeout: 5000 });

// Vitest has no globals, so Testing Library cannot register its own cleanup.
afterEach(() => cleanup());
