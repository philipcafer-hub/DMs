# Render Real-Time Messenger

A minimal messaging app with sign up, log in, profiles, and instant DMs. Built with Node.js, Express, Socket.IO and PostgreSQL. Designed to deploy on Render using a Render PostgreSQL database.

## Features
- JWT auth in httpOnly cookie (signup, login, logout)
- Update profile (display name, avatar URL, bio)
- User list (all except you)
- 1:1 direct messages with real-time delivery (Socket.IO)
- Message history with pagination-ready endpoint
- Simple, clean UI

## Local setup
1. Ensure Node 18+ is installed.
2. Create a PostgreSQL database and get the connection string (`DATABASE_URL`).
3. Copy this project and run:
   ```bash
   npm install
   export DATABASE_URL="postgres://..."
   export JWT_SECRET="replace-me"
   npm start
   ```
4. Visit http://localhost:10000

## Deploy to Render
1. Push this folder to a Git repo (GitHub/GitLab).
2. On Render:
   - Create a **PostgreSQL** database. Copy the **External Database URL** (starts with `postgres://`).
   - Create a **Web Service** from your repo.
     - Environment: **Node**
     - Build command: `npm install`
     - Start command: `npm start`
   - Add Environment Variables:
     - `DATABASE_URL` = (your Render Postgres external connection string)
     - `JWT_SECRET` = a long random string
3. Deploy. The app auto-creates tables on boot (`schema.sql`).

## Notes
- Render Postgres often requires SSL. The server auto-enables SSL when the `DATABASE_URL` looks like a Render URL.
- For production, set cookie `secure: true` (requires HTTPS). Adjust in `server.js` where cookies are set.
- To add pagination, call `GET /api/messages/:otherId?before=<ISO date>&limit=50`.

Enjoy! ✨
