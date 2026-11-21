// Supabase Edge Function entry point. All logic is in handler.mjs (tested in tests/report-card-function.cjs).
// Deploy with verify_jwt = false: visitors have no sign-in token, and reports need none.
import { createReportHandler } from './handler.mjs';

const handler = createReportHandler({
  env: (name: string) => Deno.env.get(name),
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  // Outcome words only: never the card, the report text, emails, tokens, network addresses or their hashes.
  log: (entry: Record<string, unknown>) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
