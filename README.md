# Vale! feedback endpoint

The serverless function behind Vale!'s feedback. The app, or the
website's support page, POSTs a bug report or feature request here, and the
function files it as a GitHub issue in the app's private repository. Users
need no GitHub account, and the app carries no secret: the GitHub token lives
only in this function's environment on Vercel.

It is the same function as Lectio's
([lectio-feedback](https://github.com/Lectio-Study-Planner/lectio-feedback)),
with Vale!'s repository, website origin and issue footer.

## Who calls it

At one fixed address:

**`https://vale-feedback.vercel.app/api/feedback`**

- the app, from Settings ▸ Send Feedback and, on the Mac, Help ▸ Send
  Feedback (planned: `Vale/Feedback/FeedbackClient.swift` in
  `Vale-Live-Transcripts/Vale`; the app is in development),
- the website's support page (`support.html` in
  `Vale-Live-Transcripts/vale-webpage`), from a browser.

Installed builds cannot be updated, so once a build that calls it ships,
**the address and the contract below must not change.** Keep the Vercel
project and its domain. If the domain ever has to move, the app's endpoint
constant changes in a release first, and the builds before it stop sending
feedback.

## Contract

Request, `POST` with `Content-Type: application/json`:

```json
{ "type": "bug", "title": "Captions stop after a minute", "body": "What happened…", "version": "1.0.0 (5) on iOS" }
```

| Key | Type | Meaning |
|---|---|---|
| `type` | string | `"feature"` is labelled `enhancement`; anything else is labelled `bug` |
| `title` | string | Issue title, trimmed, cut to 200 characters. Required |
| `body` | string | Issue body, trimmed, cut to 10,000 characters. Required |
| `version` | string | Written into the footer as `_Vale! v<version>_` on one line, cut to 100 characters; `?` when absent |

Any other key is ignored, and so is a key whose value is not a string. An
`@name` in the title or body gets a zero-width space after the `@`, so a report
cannot notify anyone on GitHub; an `@` inside a word, as in an email address,
is left alone.

A browser request from an origin in `ALLOWED_ORIGINS` (today only
`https://vale-live-transcripts.github.io`, the website) gets CORS headers,
and its `OPTIONS` preflight gets a `204`. Every other origin, and the app,
which sends none, get neither, so their preflight falls through to the `405`
below.

Responses:

| Status | Body | When |
|---|---|---|
| 200 | `{ "ok": true, "url": "<issue html_url>" }` | Issue filed |
| 400 | `{ "error": "Title and body are required" }` | Blank, missing or non-string title or body, or no JSON body at all |
| 405 | `{ "error": "Method not allowed" }` | Not a POST |
| 429 | `{ "error": "Too many reports. Please try again later." }` | More than 5 reports from one address in 10 minutes |
| 502 | `{ "error": "Failed to create issue" }` | GitHub refused the issue, or could not be reached |

The app and the website treat any non-2xx as "could not send".

## Configuration

Set in the Vercel project under Settings ▸ Environment Variables (Production).
Environment variable changes take effect on the next deployment.

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | Fine-grained token, owner `Vale-Live-Transcripts`, access to the `Vale` repository only, permission **Issues: Read and write** |
| `FEEDBACK_REPO` | `owner/name` of the repository issues go to. Defaults to `Vale-Live-Transcripts/Vale` |

The target repository needs the `bug` and `enhancement` labels (GitHub's
defaults).

## Deploying

A Vercel project named `vale-feedback` deploys `main` of this
repository. Vercel serves `api/feedback.js` as `/api/feedback`; there is no
build step and no dependencies. If Vercel gives the project another domain
than `vale-feedback.vercel.app`, change the address above, the app's
`FeedbackClient.endpoint` and the support page's `ENDPOINT` together, before
any build ships.

The function has no authentication: anyone who knows the address can file an
issue. Its own rate limit counts per warm instance, so it stops a burst from
one address but not a flood spread over instances. Add the real limit in the
Vercel project under Firewall ▸ Rules: a rate-limit rule on path
`/api/feedback`, for example 10 requests per 10 minutes per IP, with action
Deny (429).

## Checking it

There are no dependencies to install. To check a change locally, call the
handler with a fake `req` and `res` and replace `globalThis.fetch` with a stub
that stands in for GitHub; never point a local check at the real repository.
After a deployment, one report from the app or the support page should appear
as an issue; close it.
