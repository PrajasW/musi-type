import { useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { SettingsModal } from './components/SettingsModal';
import { useSettings } from './lib/settings';
import Home from './pages/Home';
import Watch from './pages/Watch';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const { settings } = useSettings();

  return (
    <div className="app" style={{ ['--font-size' as string]: `${settings.fontSize}rem` }}>
      <header className="topbar">
        <Link to="/" className="logo">
          <span className="accent">⌨</span> musi-type
        </Link>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">
          ⚙
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/watch/:id" element={<Watch />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
