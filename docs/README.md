# SynaptOS Documentation

This directory is the canonical documentation set for the current repository state.

## Documents

- [system-reference.md](/Users/nguyenngochoa/Git/gg-hackathon/docs/system-reference.md): architecture, runtime model, data flow, RBAC, persistence, SSE, imports, and recommendation lifecycle
- [api-reference.md](/Users/nguyenngochoa/Git/gg-hackathon/docs/api-reference.md): route-by-route request/response and authorization reference
- [developer-runbook.md](/Users/nguyenngochoa/Git/gg-hackathon/docs/developer-runbook.md): local setup, Postgres reset steps, verification, and operational notes

## Current State Summary

The app is currently a `v2` prototype:

- `Next.js` App Router frontend and internal APIs
- deterministic markdown engine
- durable Postgres persistence via `pg`
- cookie-backed RBAC sessions
- SSE-based live operator updates
- baseline CSV import path for store/snapshot/inventory seed data

The running app now uses Postgres as its runtime store.
