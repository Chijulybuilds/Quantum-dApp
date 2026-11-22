# Deploying Conclave on Vercel

One Vercel project serves both halves of Conclave from the same domain:

| Path | What | How |
|---|---|---|
| `/` | the web app (landing, airlock connect, Q-Passport, dashboard) | static files from `app/` |
| `/api/*` | the relayer and indexer (the same Hono app as `npm run dev`) | one Node.js 22 function |

`vercel.json` tells Vercel to install `server/` and `app/` and to run
[`scripts/vercel-build.mjs`](../scripts/vercel-build.mjs). That script builds the app, bundles the
relayer into a single file with esbuild, and writes Vercel's Build Output API folder
(`.vercel/output`), which Vercel deploys as is. Because the app and the API share an origin, the
app needs no `VITE_API_URL` and the API needs no CORS setup.

## Before you start

You need a deployed Conclave and its relayer recovery phrase. Both come from the local setup:

```bash
npm run keys            # creates server/.env with CONCLAVE_MNEMONIC
npm run setup:testnet   # deploys Conclave and writes contracts/deployments/testnet.json
```

## Deploy

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project**, import the repository. Leave **Root Directory** as the
   repository root and **Framework Preset** as *Other*: `vercel.json` sets the install and build
   commands.
3. Under **Environment Variables**, add:

   | Name | Value | Notes |
   |---|---|---|
   | `CONCLAVE_MNEMONIC` | the quoted phrase from `server/.env`, without the quotes | **Required.** Mark it *Sensitive*. Testnet only, never a mainnet phrase. |
   | `CONCLAVE_ADDRESS` | `address` from `contracts/deployments/testnet.json` | **Required.** |
   | `CONCLAVE_DEPLOY_BLOCK` | `blockNumber` from the same file | Recommended: the indexer starts reading events there. |
   | `DEMO_MODE` | `true` or `false` | Optional, default `true`. `true` lets visitors make the two demo members propose and vote, which costs the relayer gas. |

   Type the recovery phrase straight into Vercel's form. Do not commit it or paste it anywhere else.
4. **Deploy.** The build takes about a minute.
5. Check the API: `https://<your-project>.vercel.app/api/health` should return
   `{"ok":true,"deployed":true,…}`, then open the app and connect QoreX.

Changing an environment variable takes effect on the next deployment (**Deployments → ⋯ → Redeploy**).
After deploying a new Conclave (`npm run redeploy:testnet`), update `CONCLAVE_ADDRESS` and
`CONCLAVE_DEPLOY_BLOCK` there. Upgrading Conclave does not: the proxy address stays the same.

## Good to know

- **One relayer at a time.** The relayer's EVM and native transactions share one nonce. Inside a
  function instance they are queued; across instances or alongside a local `npm run dev` with the
  same phrase, two relays at the same moment can collide (one fails and can be retried). Reads are
  always safe. Keep local `npm run dev` for development, not while judges use the live site.
- **Keep the relayer funded.** It pays gas for every relayed proposal, vote and execution, and
  renews its scoped EVM window (40 transactions at a time). `/api/relayer` shows its balance.
- **Cold starts** re-read the contract's events since `CONCLAVE_DEPLOY_BLOCK`, which takes a
  second or two. Rate limits (per IP) are kept per function instance.
- **Time limit.** A function may run 60 s; relays give up waiting for a receipt after 45 s and
  report it, and the transaction may still land (it then appears in the activity feed).
- **QoreX mobile** needs a public HTTPS address: the Vercel URL works.
- **Preview deployments** are behind Vercel Authentication by default; the production domain is
  public.

## Build it locally

```bash
npm --prefix server ci && npm --prefix app ci
npm run build:vercel     # writes .vercel/output (static app + api.func)
```

With the Vercel CLI linked to the project, `vercel deploy --prebuilt` uploads that folder.
`.vercelignore` keeps `server/.env` and other local files out of any CLI upload.

## GitHub Pages instead

[`pages.yml`](../.github/workflows/pages.yml) still publishes the app alone to GitHub Pages. To
point it at the Vercel API, set the repository variable `CONCLAVE_API_URL` to the Vercel URL and
add the Pages origin (for example `https://<user>.github.io`) to `APP_ORIGINS` in Vercel.
