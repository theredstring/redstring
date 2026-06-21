# w3id.org Registration — Redstring Vocabulary

This document contains the files and instructions needed to register
`https://w3id.org/redstring/` as a stable IRI redirect for the
Redstring vocabulary namespace.

## What and why

`https://redstring.io/vocab/` is the current namespace. w3id.org provides
community-run, long-lived HTTP redirects — a rendezvous point that survives
domain changes. Once registered:

- `https://w3id.org/redstring/` → `https://redstring.io/vocab/`
- Dereferenceable IRIs for every `rs:` term (content-negotiated HTML or Turtle)
- After registration, update `REDSTRING_CONTEXT` in `src/formats/redstringFormat.js`
  to use the w3id namespace (one-line change).

## Current namespace in code

`src/formats/redstringFormat.js`, line ~210:
```
"redstring": "https://redstring.io/vocab/",
```

After w3id is live, change to:
```
"redstring": "https://w3id.org/redstring/",
```

and update the `@prefix rs:` line in `public/vocab/redstring.ttl` the same way.

## PR instructions

1. Fork https://github.com/perma-id/w3id.org
2. Create directory `w3id.org/redstring/`
3. Add the two files below (`.htaccess` and `README.md`)
4. Open a PR titled: "Add redirect for Redstring vocabulary namespace"

## File: `w3id.org/redstring/.htaccess`

```apache
Options -MultiViews
Require all granted

AddType text/turtle .ttl
AddType application/ld+json .jsonld

RewriteEngine on

# Content-negotiation: Turtle → vocab document
RewriteCond %{HTTP_ACCEPT} text/turtle [OR]
RewriteCond %{HTTP_ACCEPT} text/n3
RewriteRule ^(.*)$ https://redstring.io/vocab/redstring.ttl [R=303,L]

# Content-negotiation: JSON-LD → JSON-LD context
RewriteCond %{HTTP_ACCEPT} application/ld\+json
RewriteRule ^(.*)$ https://redstring.io/vocab/context.jsonld [R=303,L]

# Default: redirect to human-readable docs
RewriteRule ^(.*)$ https://redstring.io/vocab/$1 [R=303,L]
```

## File: `w3id.org/redstring/README.md`

```markdown
# Redstring Vocabulary

Namespace IRI: `https://w3id.org/redstring/`

Redirects to: `https://redstring.io/vocab/`

## About

Redstring is a React-based cognitive interface for constructing and
navigating networks of conceptual nodes. The `rs:` vocabulary defines
the spatial, visual, and cognitive overlay terms in the `.redstring`
JSON-LD format — the presentation and cognition layer that augments
(never replaces) SKOS+PROV semantics.

The vocabulary document (`redstring.ttl`) is also bundled inside the
app so that `.redstring` files remain self-interpretable in a world
where every server is gone.

## Contact

Grant Eubanks — grant.w.eubanks@gmail.com
Repository: https://github.com/[org]/redstring
```

## After the PR is merged

1. Update the namespace IRI in `src/formats/redstringFormat.js`:
   ```js
   "redstring": "https://w3id.org/redstring/",
   ```
2. Update `@prefix rs:` in `public/vocab/redstring.ttl`:
   ```turtle
   @prefix rs: <https://w3id.org/redstring/> .
   ```
3. Commit, run the full test suite (the vocab coverage test will catch
   any IRI drift).
4. Update this file to record the date the redirect went live.
