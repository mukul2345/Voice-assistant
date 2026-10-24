# Quarantined Replit Integrations

This directory contains historical Replit scaffolding and is not part of the active Interview Copilot server.

Phase 2 repository analysis confirmed that no production module imports the route registrars in this directory. The code targets an older conversation/message schema and incompatible library APIs, so it is intentionally excluded from the active TypeScript compilation rather than hidden with unsafe casts.

Do not add imports from this directory. Any future reuse requires a separate migration plan, current-schema types, security review, and production tests. Deletion is deferred until repository owners explicitly approve it.
