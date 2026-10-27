interface Props {
  wpm: number;
  accuracy: number;
  line: number;
  total: number;
}

export function StatsBar({ wpm, accuracy, line, total }: Props) {
  return (
    <div className="stats-bar">
      <div>
        <span className="label">wpm</span>
        <span className="value">{wpm}</span>
      </div>
      <div>
        <span className="label">acc</span>
        <span className="value">{Math.round(accuracy)}%</span>
      </div>
      <div>
        <span className="label">line</span>
        <span className="value">
          {Math.min(line + 1, total)}/{total}
        </span>
      </div>
    </div>
  );
}
