import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseVideoId } from '../lib/api';
import { getRecent } from '../lib/recent';

export default function Home() {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const recent = getRecent();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = parseVideoId(value);
    if (!id) return setError("That doesn't look like a YouTube link.");
    navigate(`/watch/${id}`);
  };

  return (
    <div className="page home">
      <h1>
        type the <span className="accent">song</span>
      </h1>
      <p className="lede">Paste a YouTube music video and type the lyrics as they're sung.</p>
      <form onSubmit={submit} className="url-form">
        <input
          autoFocus
          className="text big"
          placeholder="https://www.youtube.com/watch?v=…"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          spellCheck={false}
        />
        <button className="btn" type="submit">Start</button>
      </form>
      {error && <p className="error">{error}</p>}

      {recent.length > 0 && (
        <>
          <h3 className="section">Recent</h3>
          <div className="recent">
            {recent.map((s) => (
              <Link key={s.id} to={`/watch/${s.id}`} className="recent-card">
                <img src={`https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`} alt="" loading="lazy" />
                <div>
                  <strong>{s.title}</strong>
                  <span>{s.artist}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
