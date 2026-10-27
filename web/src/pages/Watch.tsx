import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useParams } from 'react-router-dom';
import { Keyboard, type KeyFlash } from '../components/Keyboard';
import { PasteLyricsModal } from '../components/PasteLyricsModal';
import { PlayerPanel } from '../components/PlayerPanel';
import { Results } from '../components/Results';
import { StatsBar } from '../components/StatsBar';
import { TypingArea } from '../components/TypingArea';
import { useAudioSync } from '../hooks/useAudioSync';
import { PlayerState, useYouTubePlayer } from '../hooks/useYouTubePlayer';
import { useTyping } from '../hooks/useTyping';
import { alignLyrics, fetchSong } from '../lib/api';
import { pushRecent } from '../lib/recent';
import { readJson, useSettings, writeJson, type Settings } from '../lib/settings';
import { charToKey } from '../lib/keymap';
import { buildLines, nextExpected, position } from '../lib/typing';
import { SOURCE_LABEL, type LyricLine, type SongData } from '../lib/types';

type Player = ReturnType<typeof useYouTubePlayer>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface SessionProps {
  title: string;
  lines: LyricLine[];
  offset: number;
  settings: Settings;
  player: Player;
  seekRef: MutableRefObject<(t: number) => void>;
  onNeedLyrics: () => void;
}

/** One typing run over a fixed set of lines. Remounted (via key) when the lines change. */
function Session({ title, lines, offset, settings, player, seekRef, onNeedLyrics }: SessionProps) {
  const texts = useMemo(() => lines.map((l) => l.text), [lines]);
  const n = lines.length;
  const { sync } = settings;
  const { time, controls } = player;
  const playing = player.state === PlayerState.PLAYING;
  const clockOn = useRef(false);
  const [flash, setFlash] = useState<KeyFlash | null>(null);
  const flashN = useRef(0);
  const { state, dispatch, stats, started, markStarted, restart } = useTyping(texts, clockOn, settings.hardMode);

  const endOf = (i: number) => lines[i].end + offset;
  const idxAt = (t: number) => {
    for (let i = 0; i < n; i++) if (endOf(i) > t) return i;
    return n;
  };
  const sungIdx = idxAt(time);

  // lines appear just before they are sung; nothing past that can be read or typed
  const REVEAL_LEAD = 0.2;
  const revealed = (() => {
    if (!settings.revealLyrics) return n;
    let k = 0;
    while (k < n && lines[k].start + offset - REVEAL_LEAD <= time) k++;
    return k;
  })();

  // follow: a line locks when the song moves past it (typing ahead is fine)
  useEffect(() => {
    if (sync === 'follow' && playing && sungIdx > state.cur) dispatch({ type: 'advanceTo', idx: sungIdx });
  }, [sync, playing, sungIdx, state.cur, dispatch]);

  // pause: the video holds just before the next line begins, until this line is typed to the end
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (sync !== 'pause' || state.done || state.cur >= n) {
      if (held) setHeld(false);
      return;
    }
    const l = lines[state.cur];
    const holdAt = Math.max(l.start + offset + 0.1, endOf(state.cur) - 0.3);
    if (playing && time >= holdAt) {
      controls.pause();
      if (!held) setHeld(true);
    } else if (held && player.state === PlayerState.PAUSED && time < holdAt - 0.05) {
      setHeld(false);
      controls.play();
    }
  });

  // The WPM clock runs whenever there is something to type, whether or not the video is
  // moving (it is deliberately stopped while "waiting for you"). It only stops when the next
  // line hasn't appeared yet, or you paused the song yourself.
  const canType = state.cur < revealed && !state.done;
  clockOn.current = canType && (sync === 'free' || playing || held || player.state === PlayerState.BUFFERING);

  useEffect(() => {
    if (player.state === PlayerState.ENDED && started) dispatch({ type: 'finish' });
  }, [player.state, started, dispatch]);

  // the seek bar lives in PlayerPanel; route it through here so typing state follows
  seekRef.current = (t: number) => {
    controls.seek(t);
    if (sync !== 'free' && n) {
      setHeld(false);
      dispatch({ type: 'seek', idx: Math.min(idxAt(t), n - 1) });
    }
  };

  // keyboard: a window listener so it works no matter what was clicked last
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
    if (t.tagName === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      controls.toggle();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      setFlash({ ids: ['backspace'], ok: true, n: ++flashN.current });
      dispatch({ type: e.ctrlKey || e.altKey ? 'deleteWord' : 'backspace' });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      setFlash({ ids: ['enter'], ok: true, n: ++flashN.current });
      dispatch({ type: 'enter' });
      return;
    }
    if (e.key.length !== 1 || state.done || !n) return;
    e.preventDefault();
    // a key press starts the song, even before the first line has appeared
    if (!player.hasStarted() && player.state !== PlayerState.PLAYING) controls.play();
    // the next line isn't out yet: wait for the music
    if (state.cur >= revealed) return;
    if (!started) markStarted();
    // light up the key you pressed: green if it was the expected character, red if not
    const pressed = charToKey(e.key);
    const { cur: typedWord } = position(state.typed[state.cur]);
    // a space at the start of a word does nothing, so it doesn't flash either
    if (pressed && !(e.key === ' ' && typedWord === '')) {
      const expected = nextExpected(texts[state.cur], state.typed[state.cur]);
      setFlash({ ids: pressed.shift ? [pressed.id, 'shift-l', 'shift-r'] : [pressed.id], ok: e.key === expected, n: ++flashN.current });
    }
    dispatch({ type: 'char', ch: e.key });
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const onLineClick = (i: number) => {
    controls.seek(Math.max(0, lines[i].start + offset - 0.1));
    dispatch({ type: 'seek', idx: i });
  };

  if (!n) {
    return (
      <div className="notice">
        <p>There are no lyrics to type yet.</p>
        <button className="btn" onClick={onNeedLyrics}>Paste lyrics</button>
      </div>
    );
  }

  if (state.done && started) {
    return (
      <Results
        stats={stats}
        title={title}
        onRestart={() => {
          restart();
          setHeld(false);
          controls.seek(0);
          controls.pause();
        }}
      />
    );
  }

  const cur = lines[Math.min(state.cur, n - 1)];
  // the key to outline next: the next character (a space between words), or backspace while the word has a mistake
  const lineIdx = Math.min(state.cur, n - 1);
  const nextKey = state.done || state.cur >= revealed ? null : nextExpected(texts[lineIdx], state.typed[lineIdx] ?? '');
  // hard mode: a wrong word can't be left until it is fixed
  const lineNeedsFix = settings.hardMode && nextKey === 'backspace';
  const deadline =
    sync === 'free' || state.done ? null : clamp((time - (cur.start + offset)) / Math.max(0.5, cur.end - cur.start), 0, 1);

  return (
    <>
      <StatsBar wpm={stats.wpm} accuracy={stats.accuracy} line={state.cur} total={n} />
      <TypingArea texts={texts} state={state} sungIdx={sync === 'free' ? -1 : sungIdx} visible={revealed} deadline={deadline} onLineClick={onLineClick} />
      {settings.keymap && <Keyboard next={nextKey} flash={flash} />}
      <p className={`tip ${held ? 'waiting' : ''}`}>
        {held
          ? 'Waiting for you… finish the line and the song carries on'
          : lineNeedsFix
            ? 'Hard mode: there is a mistake in this word. Backspace and fix it to continue'
            : started || playing
              ? settings.hardMode
                ? 'esc pauses · hard mode: every line has to be exactly right · click a line to jump'
                : 'esc pauses · enter skips the rest of a line · click a line to jump'
              : 'Press any key to start the song'}
      </p>
    </>
  );
}

export default function Watch() {
  const { id = '' } = useParams();
  const { settings } = useSettings();
  const player = useYouTubePlayer(id);
  const seekRef = useRef<(t: number) => void>((t) => player.controls.seek(t));

  const pastedKey = `musi-type:pasted:${id}`;
  const offsetKey = `musi-type:offset:${id}`;
  const [pasted, setPasted] = useState<string | null>(() => readJson<string | null>(pastedKey, null));
  const [offset, setOffset] = useState<number>(() => readJson<number>(offsetKey, 0));
  const [song, setSong] = useState<SongData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [reloadKey, setReloadKey] = useState(0); // re-align without re-fetching captions
  const [showPaste, setShowPaste] = useState(false);
  const audio = useAudioSync(id, () => setReloadKey((k) => k + 1));

  useEffect(() => {
    setPasted(readJson<string | null>(pastedKey, null));
    setOffset(readJson<number>(offsetKey, 0));
  }, [pastedKey, offsetKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const req = pasted ? alignLyrics(id, pasted, settings) : fetchSong(id, settings, tick > 0);
    req
      .then((s) => {
        if (cancelled) return;
        setSong(s);
        pushRecent({ id, title: s.title, artist: s.artist });
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // typing-only settings (sync, theme, ...) must not refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pasted, settings.sources, settings.geniusToken, tick, reloadKey]);

  const lines = useMemo(
    () => (song ? buildLines(song.lines, { lowercase: settings.lowercase, stripPunct: settings.stripPunct }) : []),
    [song, settings.lowercase, settings.stripPunct],
  );

  const nudge = (d: number) => {
    const next = Math.round((offset + d) * 10) / 10;
    setOffset(next);
    writeJson(offsetKey, next);
  };

  const sessionKey = `${id}|${song?.source}|${song?.lines.length}|${song?.lines[0]?.start}|${settings.lowercase}|${settings.stripPunct}|${settings.hardMode}|${tick}|${reloadKey}`;

  return (
    <div className="page watch">
      <div className="song-head">
        <div>
          <h1>{song?.title ?? (loading ? 'Loading…' : 'Song')}</h1>
          <p className="artist">
            {song?.artist}
            {song && <span className="badge">{SOURCE_LABEL[song.source]}</span>}
          </p>
        </div>
        <div className="head-actions">
          <div className="offset" title="Shift lyric timing if lines come too early or late">
            <button className="chip" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(-0.5)}>−0.5</button>
            <button className="chip" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(-0.1)}>−0.1</button>
            <span className="offset-val">{offset > 0 ? '+' : ''}{offset.toFixed(1)}s</span>
            <button className="chip" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(0.1)}>+0.1</button>
            <button className="chip" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(0.5)}>+0.5</button>
          </div>
          <button
            className="btn ghost"
            disabled={!audio.status?.available || audio.status.state === 'running' || Boolean(song?.audioSynced)}
            onClick={() => audio.start(pasted ?? undefined)}
            title={
              !audio.status?.available
                ? 'Optional: install faster-whisper (pip install faster-whisper) to time lyrics from the audio'
                : 'Listen to the song and time the lyrics from the audio (about a minute, runs on your computer)'
            }
          >
            {audio.status?.state === 'running'
              ? audio.status.stage === 'downloading'
                ? 'Downloading audio…'
                : `Syncing audio… ${Math.round(audio.status.progress * 100)}%`
              : song?.audioSynced
                ? 'Audio synced ✓'
                : 'Sync with audio'}
          </button>
          <button className="btn ghost" onClick={() => setShowPaste(true)}>Paste lyrics</button>
          <button className="btn ghost" onClick={() => setTick((t) => t + 1)} title="Re-fetch captions and lyrics">Refresh</button>
        </div>
      </div>

      <PlayerPanel
        videoId={id}
        mountRef={player.mountRef}
        state={player.state}
        time={player.time}
        duration={player.duration}
        error={player.error}
        muted={player.muted}
        rate={player.rate}
        controls={player.controls}
        onSeek={(t) => seekRef.current(t)}
      />

      {loading && (
        <div className="notice">Finding lyrics and timing… the first load of a song takes a few seconds.</div>
      )}
      {error && (
        <div className="notice error">
          <p>{error}</p>
          <button className="btn" onClick={() => setTick((t) => t + 1)}>Try again</button>
        </div>
      )}
      {song?.warnings.map((w) => (
        <div key={w} className={`notice ${song.lowConfidence ? 'warn' : ''}`}>
          {w}
          {song.needsLyrics && w.startsWith('No lyrics') && (
            <button className="btn" onClick={() => setShowPaste(true)}>Paste lyrics</button>
          )}
        </div>
      ))}

      {audio.error && <div className="notice error">{audio.error}</div>}
      {song?.lowConfidence && audio.status?.available && !song.audioSynced && audio.status.state !== 'running' && (
        <div className="notice">
          Timing is a guess for this video. Syncing with the audio usually fixes that.
          <button className="btn" onClick={() => audio.start(pasted ?? undefined)}>Sync with audio</button>
        </div>
      )}

      {song && !loading && (
        <Session
          key={sessionKey}
          title={song.title}
          lines={lines}
          offset={offset}
          settings={settings}
          player={player}
          seekRef={seekRef}
          onNeedLyrics={() => setShowPaste(true)}
        />
      )}

      {showPaste && (
        <PasteLyricsModal
          initial={pasted ?? ''}
          hasPasted={pasted !== null}
          onClose={() => setShowPaste(false)}
          onSubmit={(text) => {
            writeJson(pastedKey, text);
            setPasted(text);
            setShowPaste(false);
          }}
          onClear={() => {
            try {
              localStorage.removeItem(pastedKey);
            } catch {
              /* ignore */
            }
            setPasted(null);
            setShowPaste(false);
          }}
        />
      )}
    </div>
  );
}
