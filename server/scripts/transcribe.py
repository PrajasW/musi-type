"""Word-level transcription of a song with faster-whisper (CPU friendly).

usage: python transcribe.py AUDIO [--model base] [--language en] [--prompt-file lyrics.txt]

stdout: one JSON object {"language", "duration", "words": [{"text", "start", "end"}]}
stderr: "PROGRESS <0..1>" lines, so the server can show a progress bar
"""
import argparse
import json
import shutil
import subprocess
import sys
import warnings

warnings.filterwarnings("ignore")


def load_audio(path: str):
    """16 kHz mono float32 via ffmpeg. faster-whisper's own decoder (PyAV) breaks with some
    PyAV versions, so prefer ffmpeg and fall back to passing the path through."""
    if not shutil.which("ffmpeg"):
        return path
    import numpy as np

    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default="base")
    ap.add_argument("--language", default=None)
    ap.add_argument("--prompt-file", default=None)
    ap.add_argument("--beam-size", type=int, default=1)
    ap.add_argument("--vad", action="store_true", help="speech filter; it usually drops sung vocals, so it is off by default")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper is not installed: pip install faster-whisper", file=sys.stderr)
        return 3

    prompt = None
    if args.prompt_file:
        with open(args.prompt_file, encoding="utf8") as f:
            # a prompt of the real words nudges the model towards them; keep it short
            prompt = " ".join(f.read().split()[:120]) or None

    print("PROGRESS 0.02", file=sys.stderr, flush=True)
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    print("PROGRESS 0.1", file=sys.stderr, flush=True)

    audio = load_audio(args.audio)
    segments, info = model.transcribe(
        audio,
        language=args.language,
        word_timestamps=True,
        vad_filter=args.vad,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
        initial_prompt=prompt,
        beam_size=args.beam_size,
    )

    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"text": text, "start": round(w.start, 3), "end": round(w.end, 3)})
        if info.duration:
            print(f"PROGRESS {0.1 + 0.9 * min(1.0, seg.end / info.duration):.3f}", file=sys.stderr, flush=True)

    json.dump({"language": info.language, "duration": info.duration, "words": words}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
