// Dev-only: `?demo=who` opens the "Who are you?" screen with the demo unit's handlers as sample names, so the
// screen can be looked at (and tapped through) with no server. Reached only through a guarded dynamic import
// in main.tsx; never part of a production build.
import { StrictMode, useState } from 'react';
import type { Root } from 'react-dom/client';
import { WhoAreYouView } from '../ui/screens/WhoAreYouScreen';
import { DEMO_UNIT_NAME, blockOffOriginFetch, demoNames, seedDemo } from './demoSeed';

/** The real screen, fed sample names. Choosing or adding a name just carries on into the demo app. */
export function DemoWho({ onEnter }: { onEnter: (memberId?: string) => void }) {
  const [names] = useState(demoNames);
  return (
    <WhoAreYouView unitName={DEMO_UNIT_NAME} scope="handler" names={names}
      onChoose={(id) => onEnter(id)} onAdd={() => onEnter(undefined)} />
  );
}

export function renderDemoWho(root: Root, mountApp: () => void): void {
  blockOffOriginFetch();
  document.title = 'Imprint (demo: who)';
  root.render(
    <StrictMode>
      <DemoWho onEnter={(memberId) => { void seedDemo('handler', { memberId }).then(mountApp); }} />
    </StrictMode>,
  );
}
