import { THEMES, useSettings, type SyncMode } from '../lib/settings';
import { Modal } from './Modal';

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const SYNC: { id: SyncMode; label: string; hint: string }[] = [
  { id: 'follow', label: 'Follow video', hint: 'Lines lock when the song moves on (like singing along)' },
  { id: 'pause', label: 'Pause at line end', hint: 'The video stops at the end of each line until you have typed it' },
  { id: 'free', label: 'Free', hint: 'No deadlines; type at your own pace' },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const setSource = (k: keyof typeof settings.sources, v: boolean) => update({ sources: { ...settings.sources, [k]: v } });

  return (
    <Modal title="Settings" onClose={onClose}>
      <section>
        <h3>Typing</h3>
        <div className="seg">
          {SYNC.map((s) => (
            <button key={s.id} className={`chip ${settings.sync === s.id ? 'on' : ''}`} onClick={() => update({ sync: s.id })} title={s.hint}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="hint">{SYNC.find((s) => s.id === settings.sync)?.hint}</p>
        <Toggle label="Keymap" hint="Show an on-screen keyboard under the lyrics that lights up as you type" checked={settings.keymap} onChange={(v) => update({ keymap: v })} />
        <Toggle label="Hard mode" hint="A line only counts when it is typed exactly right: fix mistakes with backspace, and Enter can't skip" checked={settings.hardMode} onChange={(v) => update({ hardMode: v })} />
        <Toggle label="Reveal lyrics with the music" hint="Only the next line is previewed, faded; you can type a line once the song reaches it" checked={settings.revealLyrics} onChange={(v) => update({ revealLyrics: v })} />
        <Toggle label="Lowercase" hint="Ignore capital letters" checked={settings.lowercase} onChange={(v) => update({ lowercase: v })} />
        <Toggle label="Skip punctuation" hint="Only letters, numbers and apostrophes" checked={settings.stripPunct} onChange={(v) => update({ stripPunct: v })} />
        <label className="row">
          <span>Font size</span>
          <input type="range" min={1.1} max={2.4} step={0.1} value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
        </label>
        <div className="row">
          <span>Theme</span>
          <div className="seg">
            {THEMES.map((t) => (
              <button key={t} className={`chip ${settings.theme === t ? 'on' : ''}`} onClick={() => update({ theme: t })}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3>Lyrics sources</h3>
        <p className="hint">Checked in this order. Lyrics you paste for a song always win.</p>
        <Toggle label="LRCLIB" hint="Free synced lyrics database" checked={settings.sources.lrclib} onChange={(v) => setSource('lrclib', v)} />
        <Toggle label="Genius" hint="Fallback when LRCLIB has nothing; needs an API token" checked={settings.sources.genius} onChange={(v) => setSource('genius', v)} />
        <Toggle label="YouTube captions" hint="Creator captions: used for timing, or as lyrics if nothing else exists" checked={settings.sources.ytManual} onChange={(v) => setSource('ytManual', v)} />
        <label className="row stack">
          <span>
            Genius API token
            <small>
              Your own token: create a client at genius.com/api-clients and generate a client access token. It stays in this browser and is sent only with your requests; the server never stores it, shares it, or has a key of its own.
            </small>
          </span>
          {/* committed on blur: every change refetches the song */}
          <input
            type="password"
            className="text"
            placeholder="paste token"
            defaultValue={settings.geniusToken}
            onBlur={(e) => e.target.value.trim() !== settings.geniusToken && update({ geniusToken: e.target.value.trim() })}
            autoComplete="off"
          />
        </label>
      </section>
    </Modal>
  );
}
