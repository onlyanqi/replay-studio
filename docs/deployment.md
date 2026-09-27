# Deployment

Replay Studio is not hosted yet. GitHub Pages cannot run its queue worker or API.

## Local production build

```sh
npm ci
npm run build
# With Valkey running:
PUBLIC_ORIGIN=http://localhost:3002 npm start
npm run worker
```

Open http://localhost:3002. In production, the API serves the built frontend so there is no Vite proxy. For local HTTP, leave NODE_ENV unset; public production requires HTTPS and NODE_ENV=production for secure cookies.

## Container deployment

`docker compose up --build` starts a persistent Valkey service, the API/frontend, and a separate worker on localhost:3001. It uses an HTTP development origin by default. The Docker configuration is provided but was not exercised locally because Docker is not installed on the development machine. Native Node/Valkey startup and GitHub CI are the verified paths.

For public hosting:

- Use an always-on worker and Redis-compatible store with persistent storage and a noeviction policy.
- Set PUBLIC_ORIGIN to the exact HTTPS origin and NODE_ENV=production for the API.
- Use TLS/private networking and authentication for the store. Never expose the default local Valkey port publicly.
- Keep queue prefixes distinct for development, CI, and production.
- The API defaults to loopback; set HOST=0.0.0.0 inside a container or behind a configured proxy.
- The default session creation rate limit uses the direct socket IP. Behind a reverse proxy this may group visitors; configure a trusted proxy policy and upstream limits before public use. Do not blindly trust forwarded headers.
- Add resource quotas, storage monitoring, and scheduled retention cleanup before opening an unrestricted public demo.
- Test receipt persistence, retry delays, worker restarts, and visitor isolation at the public URL.

Hosting plans and cost limits have not been selected. The current app uses AOF every-second fsync for a learning environment, not a financial transaction durability guarantee.
