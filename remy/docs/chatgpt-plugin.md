# Private Remy ChatGPT plugin

The plugin lets the owner log food in ChatGPT and receive ETL/running-recovery advice using the same saved journal as Remy Mux. The HTTPS backend works while the owner's computer is off. It is an explicit push from a connected chat, not a daily reader of other ChatGPT conversations. Existing REMY -- ETL history remains a reviewed import.

## Workflow

Connect the private MCP server at `https://remy-mux.vercel.app/api/mcp` through ChatGPT Plugins using OAuth and approve the Remy owner consent screen. In a chat with the installed, connected plugin available, report the consumed food and portion (or a photo), and ask Remy to log it. The tools read current totals, prepare an estimate, and save the authorized draft. An explicit request to log clearly identified food does not require a second confirmation question. Unknown portions or duplicate candidates need clarification. A request for an estimate alone does not authorize logging.

A successful save returns the current saved meal and a link to the journal. If a tool was not called, failed, or only prepared a draft, the food has not been saved. The plugin does not create a daily polling job or automatically import entries from chats where its tools were not used. The earlier desktop import remains a separate workflow until it is explicitly replaced or disabled after a verified connection.

`get_profile` identifies the connected account. `get_remy_context` returns a bounded, sanitized view of nutrition, goals, running, recovery, sleep and weight. `get_food_log` supplies meal identities and current revisions. `prepare_food_log` creates a durable draft; `confirm_food_log` saves an authorized meal/correction atomically with its draft receipt.

Photos can inform ChatGPT estimates; this version does not copy the original photo to Remy storage. Provider credentials, private file paths, raw provider exports and route coordinates are excluded from the tools. Other ChatGPT conversations cannot be silently read by this connection.

## Deployment

Use the existing owner-only Supabase and Vercel deployment. Apply `202611070001_mcp_auth.sql` and `202611070002_mcp_food_snapshot.sql` before enabling `REMY_MCP_ENABLED=true`. Register one OAuth public client in Remy's broker for the verified journal owner and the **exact** callback URL displayed by ChatGPT. Public client describes the OAuth authentication method; the plugin and journal remain private. Use the registered client ID and leave the client secret blank: this broker requires PKCE and uses `token_endpoint_auth_method: none`. Never place a Supabase service key or account token in ChatGPT's connection settings. Dynamic client registration is not enabled. The server exposes OAuth authorization-server metadata and protected-resource metadata for discovery.

The connection uses Remy-specific OAuth tokens and PKCE. It does not enable Supabase's OAuth server or expose Supabase account tokens to ChatGPT. The ordinary Remy Google/email sign-in remains the owner authentication mechanism on the consent page. No additional OpenAI API key is required by the plugin; ChatGPT supplies food estimates and Remy's backend validates/persists them.

Keep the plugin private. Connect using OAuth, inspect the requested permissions, and test account identification, a saved food-log read, an authorized draft/save, retry behavior and a correction. Verify the saved record in Remy Mux before replacing a previous desktop import schedule. Revoke access at `/oauth/connections`.

## Data integrity

Each intended draft uses a UUID request ID retained across retries. Saved operations return the current saved record without overwriting later edits or restoring deletions. Corrections require the original ID and revision. Possible same-day duplicates across sources are surfaced, and a repeat requires explicit confirmation of a separate eating occasion.

Every food commit checks a complete food-revision snapshot under the same database lock used by other journal writers. A concurrent app insertion or correction invalidates that snapshot. Proposal and meal changes commit together. Journal-generation and connection-version guards reject in-flight operations after deletion, disconnection or changed authorization. Unknown nutrition remains unknown, running fuel is counted once, and historical daily summaries are never added to meal-ledger totals.

## Verification

Use Node 22, `npm test`, `npm run typecheck`, `npm run build`, and the isolated PostgreSQL checks. Tests use synthetic data and cover authorization, OAuth replay/revocation, privacy boundaries, correction conflicts, duplicate races, atomic rollback, date boundaries and repeated serverless requests. A passing local suite does not by itself establish that the production connection is installed or authorized.
