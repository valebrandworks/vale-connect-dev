// Supabase Edge Function entry point. All logic is in handler.mjs (tested in tests/purge-unconfirmed-function.cjs).
// Deploy with verify_jwt = false: the function does its own check (a shared secret in x-purge-token) and has no browser use.
// Required settings: PURGE_TOKEN (32+ random characters). Deleting stays OFF until PURGE_APPLY = 'true' is also set.
import { createPurgeHandler } from './handler.mjs';

const handler = createPurgeHandler({
  env: (name: string) => Deno.env.get(name),
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  // Outcome words and counts only: never ids or addresses.
  log: (entry: Record<string, unknown>) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
