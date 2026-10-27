import cors from 'cors';
import express from 'express';
import { songRouter } from './routes/song.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', songRouter);
app.get('/api/health', (_req, res) => void res.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`musi-type server on http://localhost:${port}`));
