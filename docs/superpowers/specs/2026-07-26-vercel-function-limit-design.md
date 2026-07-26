# Vercel Function Limit Design

## Goal

Keep the production deployment within Vercel Hobby's 12-function limit without removing local preset-file development support or coupling unrelated production APIs.

## Design

`api/presets.js` remains checked in and continues to be loaded by `tools/dev_server.mjs` for local preset-file persistence. The production frontend does not call this endpoint; deployed preset persistence uses `api/preset-snapshot.js` and Supabase.

Add `api/presets.js` to `.vercelignore`. Vercel will omit the file before route discovery, reducing the deployment from 13 functions to 12 while leaving local development behavior unchanged.

## Verification

Extend the Vercel routing test to assert that `.vercelignore` excludes `api/presets.js` and that the local development server still maps `/api/presets` to the checked-in handler. Run the focused test, static build, and full unit suite.

