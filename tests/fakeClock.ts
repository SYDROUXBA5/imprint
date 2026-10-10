/**
 * Options for vi.useFakeTimers in tests that also touch Dexie. fake-indexeddb schedules its work with
 * setImmediate; if that is faked too, Dexie transactions die halfway (a session row saved, its outbox
 * row lost) and the run turns flaky. So only the clock and the interval/timeout timers are faked.
 */
export const FAKE_CLOCK = {
  shouldAdvanceTime: true,
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
} as const;
