import { useState } from 'react';
import { Modal } from './Modal';

interface Props {
  initial: string;
  hasPasted: boolean;
  onSubmit: (lyrics: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function PasteLyricsModal({ initial, hasPasted, onSubmit, onClear, onClose }: Props) {
  const [text, setText] = useState(initial);
  return (
    <Modal title="Paste lyrics" onClose={onClose}>
      <p className="hint">
        One lyric per line. They get lined up with the video's captions, so the timing stays close to the song even when
        the captions themselves are wrong. Section markers like [Chorus] are ignored.
      </p>
      <textarea
        className="paste"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Paste the lyrics here,\none line per lyric…'}
        spellCheck={false}
      />
      <div className="actions">
        {hasPasted && (
          <button className="btn ghost" onClick={onClear}>
            Use online lyrics instead
          </button>
        )}
        <button className="btn" disabled={text.trim().length < 3} onClick={() => onSubmit(text)}>
          Use these lyrics
        </button>
      </div>
    </Modal>
  );
}
