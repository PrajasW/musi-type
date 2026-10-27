import type { PlayerControls } from '../hooks/useYouTubePlayer';
import { PlayerState } from '../hooks/useYouTubePlayer';
import type { RefObject } from 'react';

const RATES = [0.5, 0.75, 1, 1.25];

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

interface Props {
  videoId: string;
  mountRef: RefObject<HTMLDivElement>;
  state: number;
  time: number;
  duration: number;
  error: string | null;
  muted: boolean;
  rate: number;
  controls: PlayerControls;
  onSeek: (seconds: number) => void;
}

// keep focus on the page so typing never goes into a button or the iframe
const noFocus = { tabIndex: -1, onMouseDown: (e: React.MouseEvent) => e.preventDefault() } as const;

export function PlayerPanel({ videoId, mountRef, state, time, duration, error, muted, rate, controls, onSeek }: Props) {
  const playing = state === PlayerState.PLAYING;
  return (
    <div className="player">
      <div className="player-frame">
        <div className="player-mount" ref={mountRef} />
        {error ? (
          <div className="player-error">
            <p>{error}</p>
            <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
          </div>
        ) : (
          <div className="player-click" onClick={controls.toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {!playing && state !== PlayerState.BUFFERING && <div className="play-badge">▶</div>}
          </div>
        )}
      </div>
      <div className="player-controls">
        <button {...noFocus} className="icon-btn" onClick={controls.toggle} title="Play / pause (Esc)">
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="time">{fmt(time)}</span>
        <input
          {...noFocus}
          type="range"
          className="seek"
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          value={Math.min(time, duration || time)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Seek"
        />
        <span className="time">{fmt(duration)}</span>
        <div className="rates" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <button {...noFocus} key={r} className={`chip ${rate === r ? 'on' : ''}`} onClick={() => controls.setRate(r)}>
              {r}x
            </button>
          ))}
        </div>
        <button {...noFocus} className="icon-btn" onClick={controls.toggleMute} title="Mute">
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  );
}
