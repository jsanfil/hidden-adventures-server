# Hidden Adventures Server

TypeScript backend for the Hidden Adventures rebuild.

## Goals

- relational domain model with PostgreSQL + PostGIS
- hybrid API with clean resources plus workflow/query endpoints
- local-first Docker development
- cheap production deployment on AWS Lightsail

## Getting Started

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Start the local stack with `docker compose up --build`.
4. Run the app locally with `npm run dev` if you want to iterate outside Docker.

## Verified Local Commands

- `docker compose up --build -d`
- `docker compose ps`
- `docker compose exec -T app wget -qO- http://127.0.0.1:3000/`
- `docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health`
- `docker compose down`

## Initial Runtime Shape

- `app`: Fastify-based API service
- `postgres`: PostgreSQL 16 with PostGIS enabled via a repo-local ARM-native image build

## Near-Term Next Steps

- add route modules for slice 1
- add database access layer
- add auth bootstrap against Cognito
- document staging and production deployment
