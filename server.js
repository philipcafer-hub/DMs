/* server.js - Express + Socket.IO + PostgreSQL (Render) */
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

// --- Config ---
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_dev_change_me";
const DATABASE_URL = process.env.DATABASE_URL;

// Render's PostgreSQL requires SSL in many environments
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined
});

// Helpers
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function roomFor(a, b) {
  const [x, y] = [a, b].map(Number).sort((m,n)=>m-n);
  return `dm_${x}_${y}`;
}

async function ensureSchema() {
  const fs = require('fs');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql')).toString();
  await pool.query(sql);
  console.log("✅ Database schema ensured");
}

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Auth helpers
function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}
function authRequired(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Routes
app.post('/api/signup', asyncHandler(async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'username, password, displayName required' });
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id, username, display_name, bio, avatar_url, created_at`,
      [username, hash, displayName]
    );
    const user = result.rows[0];
    res.cookie('token', sign(user), { httpOnly: true, sameSite: 'lax', secure: false });
    res.json({ user });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username, password required' });
  const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const safeUser = {
    id: user.id, username: user.username, display_name: user.display_name, bio: user.bio, avatar_url: user.avatar_url, created_at: user.created_at
  };
  res.cookie('token', sign(user), { httpOnly: true, sameSite: 'lax', secure: false });
  res.json({ user: safeUser });
}));

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', authRequired, asyncHandler(async (req, res) => {
  const { id } = req.user;
  const result = await pool.query('SELECT id, username, display_name, bio, avatar_url, created_at FROM users WHERE id=$1', [id]);
  res.json({ user: result.rows[0] });
}));

app.put('/api/me', authRequired, asyncHandler(async (req, res) => {
  const { displayName, bio, avatarUrl } = req.body;
  const { id } = req.user;
  const result = await pool.query(
    `UPDATE users SET display_name=COALESCE($1, display_name), bio=COALESCE($2, bio), avatar_url=COALESCE($3, avatar_url) WHERE id=$4 RETURNING id, username, display_name, bio, avatar_url, created_at`,
    [displayName, bio, avatarUrl, id]
  );
  res.json({ user: result.rows[0] });
}));

app.get('/api/users', authRequired, asyncHandler(async (req, res) => {
  const { id } = req.user;
  const result = await pool.query('SELECT id, username, display_name, avatar_url FROM users WHERE id<>$1 ORDER BY display_name ASC', [id]);
  res.json({ users: result.rows });
}));

app.get('/api/messages/:otherId', authRequired, asyncHandler(async (req, res) => {
  const myId = req.user.id;
  const otherId = Number(req.params.otherId);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const before = req.query.before ? new Date(req.query.before) : null;

  let query = `
    SELECT id, sender_id, receiver_id, body, created_at
    FROM messages
    WHERE LEAST(sender_id, receiver_id) = LEAST($1,$2)
      AND GREATEST(sender_id, receiver_id) = GREATEST($1,$2)
  `;
  const params = [myId, otherId];
  if (before) {
    params.push(before);
    query += ` AND created_at < $3`;
  }
  query += ` ORDER BY created_at DESC LIMIT ${limit}`;
  const result = await pool.query(query, params);
  res.json({ messages: result.rows.reverse() });
}));

// Serve app
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Socket.IO auth + events ---
io.use((socket, next) => {
  // Read token from cookie header
  const cookieHeader = socket.handshake.headers.cookie || '';
  const tokenMatch = cookieHeader.split(';').map(s=>s.trim()).find(s=>s.startsWith('token='));
  if (!tokenMatch) return next(new Error('not authenticated'));
  const token = decodeURIComponent(tokenMatch.split('=')[1]);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload; // { id, username }
    return next();
  } catch (e) {
    return next(new Error('invalid token'));
  }
});

io.on('connection', (socket) => {
  const me = socket.user;

  socket.on('dm:join', (otherId) => {
    const room = roomFor(me.id, otherId);
    socket.join(room);
  });

  socket.on('dm:leave', (otherId) => {
    const room = roomFor(me.id, otherId);
    socket.leave(room);
  });

  socket.on('message:send', async ({ to, body }, cb) => {
    try {
      if (!to || !body || !body.trim()) return cb && cb({ error: 'Missing to/body' });
      const result = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1,$2,$3) RETURNING id, sender_id, receiver_id, body, created_at`,
        [me.id, to, body.trim()]
      );
      const msg = result.rows[0];
      const room = roomFor(me.id, to);
      io.to(room).emit('message:new', msg);
      cb && cb({ ok: true, message: msg });
    } catch (e) {
      console.error(e);
      cb && cb({ error: 'Failed to send' });
    }
  });

  socket.on('typing', ({ to, isTyping }) => {
    const room = roomFor(me.id, to);
    socket.to(room).emit('typing', { from: me.id, isTyping: !!isTyping });
  });
});

// Startup
(async () => {
  await ensureSchema();
  server.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
  });
})().catch(err => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
