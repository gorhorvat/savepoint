// Vercel function: every /api/* request is rewritten here (vercel.json) and
// handled by the same Express app that `npm run server` runs locally.
import { app } from '../server/index.mjs';

export default app;
