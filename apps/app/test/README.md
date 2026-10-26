# App tests

Run unit and server-rendering tests with `bun run test` from `apps/app`.
The workspace-label suite imports the database client but does not query it.
Set `TEST_DATABASE_URL` to a localhost database name ending in `_test` for this import guard.

Run provider interaction tests with `bun run test:interactions`.
These tests use Happy DOM, actual React components, and a mocked tRPC transport.
They click save, replace, remove, connection-test, mode, and model controls.
They block external requests and use fake keys only.

Run Chromium component tests with `bun run test:browser`.
The fixture server binds only `127.0.0.1:4176` and serves no production routes.
Playwright uses `/usr/bin/chromium` when present.
Otherwise, install its browser with `bunx playwright install chromium`.
The tests mock every API response and block external browser requests.
Browser artifacts go to the ignored root `.scratch/playwright` directory.
These component tests do not replace authenticated deployment testing.
