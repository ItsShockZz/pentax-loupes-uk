# Security review

This project is currently a **static frontend site — no backend, no database,
no authentication, no API keys, no file uploads.** A lot of the standard
"secure your app" checklist genuinely doesn't apply yet because there's
nothing on the other end for it to apply *to*. This doc records what was
checked, what was fixed, and — importantly — what becomes a **hard
requirement the moment a real backend gets added** (the demo form is the one
piece of this site designed to eventually talk to a server).

## Not applicable yet (no backend exists)

| Item | Why it doesn't apply now |
|---|---|
| Hide API keys / purge secrets from git | No API keys anywhere in the code. Also: this folder isn't a git repo at all yet (`git rev-parse` confirms), so there's no history to leak from. |
| Public DB key / Row Level Security | No database. |
| Encrypt sensitive data at rest | Nothing is stored anywhere — the form doesn't persist data, it simulates a submission client-side. |
| Server-side auth / lock record access / block field tampering | No accounts, no records, no auth system. |
| Secure session cookies | No sessions — the site sets no cookies at all. |
| Hash passwords | No passwords, no login. |
| Rate limit login / bot protection on login | No login form exists. |
| Parameterized queries | No database queries. |
| Trim API responses | No API. |

**None of this is a gap — it's just not built yet.** See the "when a backend
arrives" section below for what each of these becomes once one exists.

## Checked and fixed

**Input validation (demo form).** Reviewed `initDemoForm()` in `js/main.js`.
Every required field was already validated (name, email format, phone,
practice, profession, postcode, consent checkbox); tightened the phone
check from "longer than 6 characters" to an actual shape check, and added
`maxlength` to every text field in `index.html` as a hard cap. **This is UX
validation only — it is not a security boundary.** Anyone can bypass it with
devtools or a raw HTTP request. The code now says so explicitly in a comment
above the validators. The real requirement is server-side: the instant a
backend exists, every one of these checks must be re-run there before
anything touches a database, CRM, or outbound email.

**No-JS submission was leaking data into the URL.** The form had no
`action`/`method`, so if JavaScript ever failed to load, a browser's default
form submission is a GET to the current URL — which would have put the
visitor's name, email and phone number into the address bar, browser
history, and any server access logs. Added `method="post" action="#request-demo"`
as a safety net; the real path is still the JS `submit` handler
(`e.preventDefault()`), this only matters if that JS never runs.

**Escaping user content / XSS.** Audited every place the JS writes into the
DOM (`grep -n innerHTML` across `js/*.js` → zero matches). Testimonials,
magnification labels, colour labels, and form error messages all use
`.textContent`, never `innerHTML` or `outerHTML`. The one place a value gets
assigned to an element property is `portrait.src = t.image` in
`initTestimonials()` — that's a hardcoded path from `js/config.js`, not user
input. **Conclusion: nothing on this site currently reflects user input back
into the page, so there is no XSS surface today.** This needs re-checking
the day anything (a "your enquiries" page, a comments feature, anything that
echoes back what a visitor typed) gets added.

**Dependency / third-party trust.** No `package.json`, no npm dependencies —
nothing to run `npm audit` against. One third-party network dependency
remains, loaded in `index.html`:
- **Google Fonts** (`fonts.googleapis.com` / `fonts.gstatic.com`) — Google-operated, high trust, industry-standard. No SRI possible on the CSS endpoint (its response varies by requesting browser, so there's no single fixed hash to pin — this is a known, accepted limitation of Google Fonts' CSS API, not an oversight).

  The Sketchfab Viewer API this section previously covered (with a pinned
  SRI hash) has been removed from the site entirely — the 3D embed was
  dropped in favour of scroll-scrubbed video footage (see `TODO.md`). The
  site now loads zero third-party `<script>` tags.

**File uploads.** The demo form has no file upload field, matching the brief
(fields are name/email/phone/practice/profession/postcode/magnification/contact
preference/message/consent — all text). Not applicable. If one gets added
later: validate file type and size **server-side** (never trust a client-side
`accept` attribute or `Content-Type` header alone), and don't serve uploaded
files from the same origin as the main site without a plan for stored-XSS
(e.g. an uploaded `.svg` or `.html` file being served and executed as if it
were site content).

## Documented, but not "fixed" — these are hosting-layer, not code

Static HTML/CSS/JS can't set HTTP response headers or force a protocol
upgrade on itself; whatever serves this site does. Below is what to
configure once a host is chosen, plus a CSP that actually matches this
site's real dependencies (not a generic template).

**Why the CSP looks like this:** the site loads no third-party scripts and
embeds no iframes any more (the Sketchfab embed is gone — see above), so
`script-src` is just `'self'` and there's no `frame-src` to add. `media-src`
covers the chapter videos in `/videos`. The inline
`<script type="application/ld+json">` (structured data for SEO) is not
script *execution* and Chrome/most browsers don't apply `script-src` to it,
but if a stricter host blocks it, that block is what to look at first.
`style-src` includes `'unsafe-inline'` because the site uses inline
`style="..."` attributes in several places for one-off spacing — given the
confirmed absence of any XSS injection point above, the residual risk of
allowing that is low; tightening it to per-element hashes is a worthwhile
future cleanup but not urgent.

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com;
  img-src 'self';
  media-src 'self';
  connect-src 'self';
  frame-ancestors 'self';
  base-uri 'self';
  form-action 'self';

X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

Note: `X-Frame-Options` is superseded by CSP's `frame-ancestors` above —
set both only if you need to support very old browsers; `frame-ancestors`
alone is sufficient for anything modern.

**Netlify** — create a `_headers` file at the project root:
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```
Netlify forces HTTPS and redirects HTTP → HTTPS by default; no extra config needed.

**Vercel** — add to `vercel.json`:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" }
      ]
    }
  ]
}
```
Vercel also forces HTTPS by default.

**Nginx** — inside the relevant `server { }` block (the HTTPS one — see the
redirect block below):
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```
Force HTTPS with a separate redirect server block:
```nginx
server {
  listen 80;
  server_name pentaxloupes.co.uk www.pentaxloupes.co.uk;
  return 301 https://$host$request_uri;
}
```

## When a real backend/database/auth gets added

The moment the demo form gets a real endpoint, the "not applicable yet"
table above stops being a pass and becomes a checklist:

- Re-validate every form field **server-side** — client-side validation
  (however solid) is UX only, never trust it as the security boundary.
- Rate-limit and add bot protection to the submit endpoint (the brief
  already asks for "a hook/place for spam protection integration" — this is
  that hook becoming load-bearing).
- Don't put any API keys, CRM tokens, or email-service credentials in
  frontend code — they belong server-side, in environment variables, never
  committed to git.
- If a database gets involved: parameterized queries only, least-privilege
  DB credentials, and if it's something like Supabase/Firebase with a public
  client key, Row Level Security policies locking records to their owner.
- If any form of login/account gets added: hashed + salted passwords
  (bcrypt/argon2, never rolled by hand), secure session cookies
  (`HttpOnly; Secure; SameSite=Strict`), and rate-limited login attempts.
- Update the CSP's `connect-src` above to include the real API endpoint's
  origin once it exists.

See `TODO.md` for the actioned/owner-facing version of this list.
