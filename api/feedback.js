// Files feedback from Vale! as a GitHub issue, so the user needs no
// GitHub account and the app carries no secret: the token lives only in this
// function's environment.
//
// Called by the Vale! app (planned: `Vale/Feedback/FeedbackClient.swift` in
// Vale-Live-Transcripts/Vale) and by the website's support page
// (Vale-Live-Transcripts/vale-webpage). The request and response
// shapes below are a contract with apps in users' hands; do not rename a key
// or change a status.
//
//   request:  POST { type: 'bug' | 'feature', title, body, version }
//   success:  200 { ok: true, url }   (the new issue's html_url)
//   rejected: 400 / 405 / 429 / 502 { error }
//
// The same function as Lectio's (Lectio-Study-Planner/lectio-feedback), with
// Vale!'s repository, website origin and issue footer.
//
// The website calls it from a browser, so the site's origin gets CORS headers
// and an answer to the preflight. The app sends no Origin and sees neither.
//
// Anyone who knows the address can call it, so the input is treated as
// untrusted: only strings are read, each is capped, @mentions cannot ping
// anyone, and each caller is held to a few reports per window (see
// `isRateLimited`).

const DEFAULT_REPO = 'Vale-Live-Transcripts/Vale';
const ALLOWED_ORIGINS = ['https://vale-live-transcripts.github.io'];

// Caps on what reaches the issue. Longer input is cut, not rejected, so a
// long report still arrives.
const MAX_TITLE = 200;
const MAX_BODY = 10000;
const MAX_VERSION = 100;

// At most RATE_LIMIT reports per caller per RATE_WINDOW_MS.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

// Per warm instance only: Vercel may run several instances and recycles them,
// so this stops a burst from one caller, not a determined flood. The project's
// Firewall rate-limit rule (see the README) is the real limit.
const recentCalls = new Map();

export default async function handler(req, res) {
  if (ALLOWED_ORIGINS.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  }

  // POST only.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // A missing, non-JSON or non-object body reads as empty, and so fails the
  // check below with a 400 rather than throwing a 500.
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const title = text(payload.title, MAX_TITLE);
  const body = text(payload.body, MAX_BODY);
  const version = text(payload.version, MAX_VERSION).replace(/\s+/g, ' ');

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required' });
  }

  if (isRateLimited(callerOf(req))) {
    return res.status(429).json({ error: 'Too many reports. Please try again later.' });
  }

  const label = payload.type === 'feature' ? 'enhancement' : 'bug';
  const fullBody = `${defuseMentions(body)}\n\n---\n_Vale! v${version || '?'}_`;
  const repo = process.env.FEEDBACK_REPO || DEFAULT_REPO;

  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: defuseMentions(title),
        body: fullBody,
        labels: [label],
      }),
    });
  } catch (err) {
    console.error('GitHub API unreachable:', err);
    return res.status(502).json({ error: 'Failed to create issue' });
  }

  if (!response.ok) {
    const err = await response.text();
    console.error('GitHub API error:', response.status, err);
    return res.status(502).json({ error: 'Failed to create issue' });
  }

  const issue = await response.json();
  return res.status(200).json({ ok: true, url: issue.html_url });
}

// `value` trimmed and cut to `max` characters, or '' when it is not a string.
function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Breaks every `@name` with a zero-width space after the `@`, so a report
// cannot notify a GitHub user or team. The text still reads the same. An `@`
// inside a word, as in an email address, is no mention and is left alone.
function defuseMentions(value) {
  return value.replace(/(?<![A-Za-z0-9_.+-])@(?=[A-Za-z0-9])/g, '@​');
}

// The caller's address as Vercel reports it.
function callerOf(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  return first || req.headers['x-real-ip'] || 'unknown';
}

// Records a call from `caller` and says whether it is over the limit.
function isRateLimited(caller) {
  const now = Date.now();
  const calls = (recentCalls.get(caller) || []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = calls.length >= RATE_LIMIT;
  if (!limited) {
    calls.push(now);
  }
  recentCalls.set(caller, calls);
  // Forget idle callers so the map cannot grow without bound.
  if (recentCalls.size > 1000) {
    for (const [key, times] of recentCalls) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) {
        recentCalls.delete(key);
      }
    }
  }
  return limited;
}
