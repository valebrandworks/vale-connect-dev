// Supabase Edge Function entry point. All logic is in handler.mjs (tested in tests/share-card-function.cjs).
// Deploy with verify_jwt = false: visitors have no sign-in token and the new API keys aren't JWTs, so the handler
// checks member sign-ins itself through Supabase Auth.
import { createShareHandler } from './handler.mjs';

const handler = createShareHandler({
  env: (name: string) => Deno.env.get(name),
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  // Outcome words only: never names, contact details, tokens, network addresses or their hashes.
  log: (entry: Record<string, unknown>) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
