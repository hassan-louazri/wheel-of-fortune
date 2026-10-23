import { useState } from 'react';
import { Game } from './components/Game';
import { LanguageSelector } from './components/LanguageSelector';

export function App() {
  const [languageOpen, setLanguageOpen] = useState(false);

  return (
    <div className="app-shell">
      <header>
        <img className="brand-image" src="/assets/logo.png" alt="CFOCO" />
        <LanguageSelector onOpen={() => setLanguageOpen(true)} />
      </header>
      <main>
        <Game languageOpen={languageOpen} onLanguageClose={() => setLanguageOpen(false)} />
      </main>
    </div>
  );
}
