# Security

## Reporting a problem

If you find a security issue in musi-type, please **don't open a public issue**. Use GitHub's private
[security advisory form](https://github.com/PrajasW/musi-type/security/advisories/new) for this repository, or contact the
maintainer directly. Include what you found and how to reproduce it. You'll get a reply as soon as possible.

## What is protected

The details are in the README ("Deploying" and "Security"). In short:

- **Secrets never live in the repository or the browser bundle.** API keys are environment variables on the server only.
  A test scans the whole repo for anything that looks like a credential and fails the build if it finds one.
- **Genius tokens are per user.** There is no shared key. A token is sent only with its owner's own requests, is never
  logged or stored on the server, and responses that used it are never cached.
- **The API is rate limited** per client and, for the costly endpoints, across all clients together. It validates every
  input, caps request sizes, refuses unknown browser origins and unneeded HTTP methods, and returns short errors with no
  internals.
- **The site sets a Content Security Policy** and the host adds the usual security headers.
- **Dependencies are watched** by Dependabot, and CI fails on known high-severity vulnerabilities.

## If a key leaks

1. Revoke or rotate it at its provider right away (Google Cloud Console for the YouTube Data API key, genius.com/api-clients
   for a Genius token). A leaked key is compromised even if you delete the commit.
2. Replace it in the host's environment settings (never in code) and redeploy.
3. Check the provider's usage page for activity you don't recognise.
