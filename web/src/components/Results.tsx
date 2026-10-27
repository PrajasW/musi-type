import type { TypingStats } from '../hooks/useTyping';

function Chart({ samples }: { samples: TypingStats['samples'] }) {
  if (samples.length < 2) return <div className="chart-empty">Not enough data for a graph</div>;
  const W = 640, H = 160, P = 28;
  const maxY = Math.max(20, ...samples.map((s) => Math.max(s.wpm, s.raw))) * 1.1;
  const x = (i: number) => P + (i / (samples.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / maxY) * (H - 2 * P);
  const path = (k: 'wpm' | 'raw') => samples.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ');
  const errs = samples.map((s, i) => ({ i, d: s.errors - (samples[i - 1]?.errors ?? 0) })).filter((e) => e.d > 0);
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxY * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="WPM over time">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P} x2={W - P} y1={y(t)} y2={y(t)} className="grid" />
          <text x={P - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
        </g>
      ))}
      <path d={path('raw')} className="raw" fill="none" />
      <path d={path('wpm')} className="net" fill="none" />
      {errs.map((e) => (
        <text key={e.i} x={x(e.i)} y={y(samples[e.i].wpm) - 6} textAnchor="middle" className="err">×</text>
      ))}
    </svg>
  );
}

interface Props {
  stats: TypingStats;
  title: string;
  onRestart: () => void;
}

export function Results({ stats, title, onRestart }: Props) {
  const { counts } = stats;
  const seconds = Math.round(stats.activeMs / 1000);
  return (
    <div className="results">
      <div className="results-top">
        <div className="big">
          <span className="label">wpm</span>
          <span className="value">{stats.wpm}</span>
        </div>
        <div className="big">
          <span className="label">acc</span>
          <span className="value">{Math.round(stats.accuracy)}%</span>
        </div>
        <Chart samples={stats.samples} />
      </div>
      <div className="results-row">
        <div><span className="label">song</span><span className="small">{title}</span></div>
        <div><span className="label">raw</span><span className="small">{stats.raw}</span></div>
        <div>
          <span className="label">consistency</span>
          <span className="small">{stats.consistency === null ? '-' : `${Math.round(stats.consistency)}%`}</span>
        </div>
        <div>
          <span className="label">characters</span>
          <span className="small" title="correct / incorrect / missed">
            {counts.correct}/{counts.incorrect}/{counts.missed}
          </span>
        </div>
        <div><span className="label">time</span><span className="small">{seconds}s</span></div>
      </div>
      <button className="btn" onClick={onRestart}>Restart</button>
    </div>
  );
}
