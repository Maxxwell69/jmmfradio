import crypto from 'node:crypto';

// Constant-time comparison so a wrong-length guess doesn't leak info via early return timing.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Single hardcoded admin account via env vars — this is the Solo build, not the
// multi-tenant one. Swap for a real users table when that work starts.
export function verifyCredentials(email, password) {
  const expectedEmail = process.env.ADMIN_EMAIL || '';
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  if (!expectedEmail || !expectedPassword) return false;
  return (
    safeEqual(String(email || '').trim().toLowerCase(), expectedEmail.trim().toLowerCase()) &&
    safeEqual(String(password || ''), expectedPassword)
  );
}

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.method === 'GET' && req.accepts('html')) return res.redirect('/');
  return res.status(401).json({ error: 'Sign in required.' });
}
