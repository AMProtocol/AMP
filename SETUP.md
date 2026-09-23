# AgentManifest Setup Guide

Complete guide to getting AgentManifest running locally and in production.

## Quick Start (5 Minutes)

### Prerequisites
- Node.js 18+ installed
- Docker and Docker Compose installed
- PostgreSQL 15+ (if not using Docker)

### Option 1: Docker Compose (Recommended)

```bash
# Clone/navigate to the repository
cd agentmanifest

# Start everything (PostgreSQL + Validator + Registry)
docker-compose up -d

# Check services are running
docker-compose ps

# View logs
docker-compose logs -f

# Access services:
# - Validator: http://localhost:3001
# - Registry: http://localhost:3002
# - PostgreSQL: localhost:5432
```

### Option 2: Manual Setup

```bash
# Install root dependencies
npm install

# Setup Validator
cd validator
npm install
npm run build

# Setup Registry
cd ../registry
npm install

# Create PostgreSQL database
createdb agentmanifest_registry

# Configure environment
cat > .env << EOF
DATABASE_URL=postgresql://localhost:5432/agentmanifest_registry
VALIDATOR_URL=http://localhost:3001
PORT=3002
EOF

# Setup database
npm run prisma:generate
npm run prisma:push
npm run prisma:seed

# Start services (in separate terminals)
cd ../validator && npm run dev      # Terminal 1
cd ../registry && npm run dev        # Terminal 2
```

## Verifying Installation

### Test the Validator

```bash
# Check health
curl http://localhost:3001/health

# Get spec schema
curl http://localhost:3001/spec

# Validate a manifest by URL
curl -X POST http://localhost:3001/validate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-api.com"}'
```

### Test the Registry

```bash
# Check health
curl http://localhost:3002/health

# Get agent instructions
curl http://localhost:3002/agents

# List all listings
curl http://localhost:3002/listings

# Browse categories
curl http://localhost:3002/categories
```

### Test the Validator CLI

```bash
cd validator

# Run validation
npm run cli -- validate https://api.example.com

# Or install globally
npm install -g .
amp validate https://api.example.com
```

## Development Workflow

### Making Changes to the Validator

```bash
cd validator

# Edit source files in src/
# TypeScript will auto-compile with:
npm run dev

# Test your changes
npm run cli -- validate <test-url>

# Build for production
npm run build
```

### Making Changes to the Registry

```bash
cd registry

# Edit source files in src/
# Server will auto-reload with:
npm run dev

# Test endpoints
curl http://localhost:3002/listings

# After changing Prisma schema:
npm run prisma:generate
npm run prisma:push
npm run prisma:seed  # Re-seed if needed
```

### Database Management

```bash
cd registry

# View database in GUI
npm run prisma:studio

# Create a new migration
npm run prisma:migrate

# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Re-seed data
npm run prisma:seed
```

## Submitting an API to the Registry

```bash
# Validate your API
cd validator
npm run cli -- validate https://your-api.com

# Submit to local registry
curl -X POST http://localhost:3002/listings/submit \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-api.com"}'

# Check submission status (use ID from response)
curl http://localhost:3002/listings/submit/{submission_id}/status

# Once verified, view the listing
curl http://localhost:3002/listings
```

## Production Deployment

### Deploying to Railway

#### 1. Deploy PostgreSQL

```bash
# In Railway dashboard:
# 1. Create new project
# 2. Add PostgreSQL database service
# 3. Note the DATABASE_URL (Railway auto-generates this)
```

#### 2. Deploy Validator

```bash
# Push validator to GitHub
# In Railway:
# 1. New service -> GitHub repo
# 2. Root directory: /validator
# 3. Set environment variables:
#    - PORT=3001
#    - JWT_SECRET=<generate-random-secret>
# 4. Deploy
```

#### 3. Deploy Registry

```bash
# In Railway:
# 1. New service -> GitHub repo
# 2. Use railway.json config (already configured)
# 3. Set environment variables:
#    - DATABASE_URL=<from PostgreSQL service>
#    - VALIDATOR_URL=<validator service URL>
#    - PORT=3002
#    - JWT_SECRET=<same as validator>
# 4. Deploy
```

The registry will automatically:
- Run Prisma migrations
- Generate Prisma client
- Seed database
- Start the server

### Environment Variables

#### Validator
- `PORT` - Server port (default: 3001)
- `JWT_SECRET` - Secret for signing verification tokens (required in production)
- `NODE_ENV` - Set to 'production' in production

#### Registry
- `PORT` - Server port (default: 3002)
- `DATABASE_URL` - PostgreSQL connection string (required)
- `VALIDATOR_URL` - URL of validator service (default: http://localhost:3001)
- `REGISTRY_URL` - Public URL of registry (for custom headers)
- `NODE_ENV` - Set to 'production' in production

### Security Considerations

1. **JWT Secret**: Generate a strong random secret for production
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Database**: Use connection pooling and SSL in production
   ```
   DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require&connection_limit=10
   ```

3. **Rate Limiting**: Consider adding rate limiting to both services

4. **CORS**: In production, restrict CORS to known domains instead of '*'

## Troubleshooting

### Validator Not Starting

```bash
# Check Node version
node --version  # Should be 18+

# Check for port conflicts
lsof -i :3001

# View detailed logs
cd validator && npm run dev
```

### Registry Not Starting

```bash
# Check database connection
psql $DATABASE_URL

# Regenerate Prisma client
cd registry
npm run prisma:generate

# Check migrations
npm run prisma:migrate

# View logs
npm run dev
```

### Database Issues

```bash
# Can't connect to PostgreSQL
# Check PostgreSQL is running:
sudo systemctl status postgresql  # Linux
brew services list                # macOS

# Can't create database
createdb -h localhost -U postgres agentmanifest_registry

# Connection refused
# Check DATABASE_URL format:
# postgresql://[user]:[password]@[host]:[port]/[database]
```

### Validation Fails

```bash
# 403 on manifest URL
# - Check manifest endpoint exists
# - Verify CORS is enabled
# - Test with curl directly

# Schema validation fails
# - Verify JSON is valid
# - Check all required fields present
# - Ensure categories are from controlled vocabulary

# Endpoint tests fail
# - GET endpoints should return non-500 status
# - Check endpoint paths are correct
```

### Docker Issues

```bash
# Services won't start
docker-compose down
docker-compose up --build

# Database connection fails
# Check that postgres service is healthy:
docker-compose ps

# Reset everything
docker-compose down -v  # WARNING: Deletes all data
docker-compose up --build
```

## Testing the Complete Flow

End-to-end test:

```bash
# 1. Ensure all services running
curl http://localhost:3001/health
curl http://localhost:3002/health

# 2. Validate an API
cd validator
npm run cli -- validate https://your-api.com

# 3. Submit to registry
curl -X POST http://localhost:3002/listings/submit \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-api.com"}'

# 4. Check status (use submission_id from response)
curl http://localhost:3002/listings/submit/sub_xxxxx/status

# 5. Query registry
curl http://localhost:3002/listings

# 6. Get full listing details
curl http://localhost:3002/listings/{listing_id}
```

## Next Steps

1. **Deploy to production** - Follow Railway deployment steps above
2. **Test end-to-end** - Validate an API and submit to registry
3. **Monitor** - Set up health check monitoring for both services
4. **Scale** - Configure auto-scaling and load balancing as needed

## Getting Help

- Check `README.md` for overview and vision
- See `spec/v0.3.md` for complete specification
- Review `validator/README.md` for validator details
- Check `registry/README.md` for registry API reference
- See README for how to add manifests to your API

## Development Tips

### Hot Reload

Both services use `tsx watch` for hot reload during development. Changes to TypeScript files will automatically restart the server.

### Debugging

```bash
# Add breakpoints and run with Node inspector
node --inspect node_modules/.bin/tsx src/index.ts

# Or use VS Code debugger with this launch.json:
{
  "type": "node",
  "request": "launch",
  "name": "Debug",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["run", "dev"],
  "skipFiles": ["<node_internals>/**"]
}
```

### Database Migrations

When changing the Prisma schema:

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate new migration
npm run prisma:migrate

# 3. Apply to database
npm run prisma:push

# 4. Regenerate client
npm run prisma:generate
```

### Testing New Manifests

Create test manifests in a test directory and validate them:

```bash
# Start a simple HTTP server with test manifest
cd test
python3 -m http.server 8000

# Place test manifest at .well-known/agent-manifest.json
# Validate
cd ../validator
npm run cli -- validate http://localhost:8000
```
