# Deploying AMP

## Auto-deploy (GitHub → Railway)

Push to `main` and Railway deploys both services.

### What runs on deploy

| Service   | Build                          | Start                                      |
|-----------|--------------------------------|--------------------------------------------|
| Validator | `npm ci --no-workspaces` → `npm run build` | `npm run start:web`                         |
| Registry  | `npm ci --no-workspaces` → `prisma generate` → `npm run build` | `npm run start` (includes `prisma db push`) |

Railway clones the full monorepo but builds from `registry/` or `validator/`. Use **`npm ci --no-workspaces`** and the per-service **`package-lock.json`** so npm does not walk the root workspace (avoids `edgesOut` install failures).

### Registry: No seed

The registry **does not seed** on deploy. Listings come from `POST /listings/submit`. For local dev with placeholder data, run `npm run prisma:seed` manually.

### Schema changes

`prisma db push` applies schema changes on every deploy. No migration files. When we added `validation_result` and removed `badges`, the next deploy applies that automatically. Existing listings get `validation_result: null` (badges show as `[]` until revalidated).

### Prerequisites

- **Validator**: None
- **Registry**: PostgreSQL linked via `DATABASE_URL`
- **Root directories**: `validator` and `registry` set in Railway

### After deploy

1. Validator: `curl https://validator.agent-manifest.com/health`
2. Registry: `curl https://api.agent-manifest.com/health`
3. Submit an API: `curl -X POST https://api.agent-manifest.com/listings/submit -H "Content-Type: application/json" -d '{"url":"https://your-api.com"}'`
