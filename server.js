const express = require('express');
const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'scoreboard.db');

const fs = require('fs');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'admin123';
const SESSION_TOKEN  = 'rc_admin_auth';

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map(c => c.trim().split('=').map(decodeURIComponent)));
}

function isAuthenticated(req) {
  return parseCookies(req)[SESSION_TOKEN] === 'granted';
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (req.method === 'GET') return res.redirect('/login');
  return res.status(401).json({ error: 'Unauthorized' });
}

let db;
let activeMatchId = null;

const dbRun = (sql, ...params) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve(this);
  });
});
const dbGet = (sql, ...params) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});
const dbAll = (sql, ...params) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});
const dbExec = sql => new Promise((resolve, reject) => {
  db.exec(sql, err => {
    if (err) return reject(err);
    resolve();
  });
});

async function initDb() {
  db = new sqlite3.Database(DB_PATH);

  await dbExec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      logo TEXT
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      name TEXT NOT NULL,
      position TEXT,
      number INTEGER,
      FOREIGN KEY(team_id) REFERENCES teams(id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      home_team_id INTEGER,
      away_team_id INTEGER,
      venue TEXT,
      date TEXT,
      referee TEXT,
      status TEXT DEFAULT 'SCHEDULED',
      match_time_seconds INTEGER DEFAULT 0,
      timer_running INTEGER DEFAULT 0,
      home_score INTEGER DEFAULT 0,
      away_score INTEGER DEFAULT 0,
      home_yellow INTEGER DEFAULT 0,
      away_yellow INTEGER DEFAULT 0,
      home_red INTEGER DEFAULT 0,
      away_red INTEGER DEFAULT 0,
      home_corners INTEGER DEFAULT 0,
      away_corners INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(home_team_id) REFERENCES teams(id),
      FOREIGN KEY(away_team_id) REFERENCES teams(id)
    );
    CREATE TABLE IF NOT EXISTS match_player_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER,
      player_id INTEGER,
      goals INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      yellow_cards INTEGER DEFAULT 0,
      red_cards INTEGER DEFAULT 0,
      FOREIGN KEY(match_id) REFERENCES matches(id),
      FOREIGN KEY(player_id) REFERENCES players(id)
    );
    CREATE TABLE IF NOT EXISTS match_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER,
      type TEXT,
      team TEXT,
      player_id INTEGER,
      related_player_id INTEGER,
      assist_player_id INTEGER,
      description TEXT,
      timestamp_seconds INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(match_id) REFERENCES matches(id),
      FOREIGN KEY(player_id) REFERENCES players(id),
      FOREIGN KEY(related_player_id) REFERENCES players(id),
      FOREIGN KEY(assist_player_id) REFERENCES players(id)
    );
    CREATE TABLE IF NOT EXISTS match_lineups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER,
      player_id INTEGER,
      role TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(match_id) REFERENCES matches(id),
      FOREIGN KEY(player_id) REFERENCES players(id)
    );
  `);

  const statsInfo = await dbAll("PRAGMA table_info(match_player_stats)");
  if (!statsInfo.some(c => c.name === 'assists')) {
    await dbRun('ALTER TABLE match_player_stats ADD COLUMN assists INTEGER DEFAULT 0');
  }

  const matchInfo = await dbAll("PRAGMA table_info(matches)");
  const columnsToAdd = [
    { name: 'home_shots', type: 'INTEGER DEFAULT 0' },
    { name: 'away_shots', type: 'INTEGER DEFAULT 0' },
    { name: 'home_fouls', type: 'INTEGER DEFAULT 0' },
    { name: 'away_fouls', type: 'INTEGER DEFAULT 0' },
    { name: 'home_possession', type: 'INTEGER DEFAULT 50' },
    { name: 'away_possession', type: 'INTEGER DEFAULT 50' },
    { name: 'mvp_player_id', type: 'INTEGER' }
  ];
  for (const col of columnsToAdd) {
    if (!matchInfo.some(c => c.name === col.name)) {
      await dbRun(`ALTER TABLE matches ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  const teamCount = await dbGet('SELECT COUNT(*) AS count FROM teams');
  if (teamCount.count === 0) {
    await seedSampleData();
  }
}

async function seedSampleData() {
  const teams = [
    { name: 'Rahula College', logo: 'https://images.unsplash.com/photo-1547036967-23d11aafa9b7?auto=format&fit=crop&w=400&q=80' },
    { name: 'St. Marys School', logo: 'https://images.unsplash.com/photo-1483721310020-03333e577078?auto=format&fit=crop&w=400&q=80' }
  ];

  const inserted = [];
  for (const team of teams) {
    const result = await dbRun('INSERT INTO teams (name, logo) VALUES (?, ?)', team.name, team.logo);
    inserted.push(result.lastID);
  }

  const players = [
    // Rahula College (11 players)
    { team_id: inserted[0], name: 'Aravind Silva', position: 'Forward', number: 9 },
    { team_id: inserted[0], name: 'Nimal Perera', position: 'Forward', number: 11 },
    { team_id: inserted[0], name: 'Kamal Jayasuriya', position: 'Goalkeeper', number: 1 },
    { team_id: inserted[0], name: 'Malinda Fernando', position: 'Defender', number: 2 },
    { team_id: inserted[0], name: 'Ananda Kumar', position: 'Defender', number: 4 },
    { team_id: inserted[0], name: 'Roshan Perera', position: 'Defender', number: 5 },
    { team_id: inserted[0], name: 'Dilshan Wickrama', position: 'Midfielder', number: 6 },
    { team_id: inserted[0], name: 'Thilanka Silva', position: 'Midfielder', number: 7 },
    { team_id: inserted[0], name: 'Chaminda Jayasooriya', position: 'Midfielder', number: 8 },
    { team_id: inserted[0], name: 'Chandana Herath', position: 'Midfielder', number: 10 },
    { team_id: inserted[0], name: 'Suresh Kumara', position: 'Forward', number: 3 },
    // St. Marys School (11 players)
    { team_id: inserted[1], name: 'Supun Fernando', position: 'Forward', number: 10 },
    { team_id: inserted[1], name: 'Malith Kumara', position: 'Forward', number: 9 },
    { team_id: inserted[1], name: 'Dasun Lakshan', position: 'Midfielder', number: 6 },
    { team_id: inserted[1], name: 'Nishan Silva', position: 'Goalkeeper', number: 1 },
    { team_id: inserted[1], name: 'Chathura Perera', position: 'Defender', number: 2 },
    { team_id: inserted[1], name: 'Sampath Jayasiri', position: 'Defender', number: 4 },
    { team_id: inserted[1], name: 'Wimala Ratnayake', position: 'Defender', number: 5 },
    { team_id: inserted[1], name: 'Janith Wijesinghe', position: 'Midfielder', number: 7 },
    { team_id: inserted[1], name: 'Harsha Pradeep', position: 'Midfielder', number: 8 },
    { team_id: inserted[1], name: 'Udaya Fernando', position: 'Midfielder', number: 11 }
  ];

  for (const player of players) {
    await dbRun('INSERT INTO players (team_id, name, position, number) VALUES (?, ?, ?, ?)', player.team_id, player.name, player.position, player.number);
  }

}

function sanitizeMatchRows(rows) {
  return rows.map(row => {
    const time = Number(row.match_time_seconds || 0);
    const hy = Number(row.home_yellow || 0);
    const ay = Number(row.away_yellow || 0);
    const hr = Number(row.home_red || 0);
    const ar = Number(row.away_red || 0);
    const hs = Number(row.home_shots || 0);
    const as = Number(row.away_shots || 0);
    return {
      ...row,
      timer_running: !!row.timer_running,
      match_time_seconds: time,
      match_time: time,
      home_score: Number(row.home_score || 0),
      away_score: Number(row.away_score || 0),
      home_yellow: hy,
      home_yellow_cards: hy,
      away_yellow: ay,
      away_yellow_cards: ay,
      home_red: hr,
      home_red_cards: hr,
      away_red: ar,
      away_red_cards: ar,
      home_corners: Number(row.home_corners || 0),
      away_corners: Number(row.away_corners || 0),
      home_shots: hs,
      home_shots_on_target: hs,
      away_shots: as,
      away_shots_on_target: as,
      home_fouls: Number(row.home_fouls || 0),
      away_fouls: Number(row.away_fouls || 0),
      home_possession: Number(row.home_possession || 50),
      away_possession: Number(row.away_possession || 50),
      mvp_player_id: row.mvp_player_id ? Number(row.mvp_player_id) : null
    };
  });
}

async function fetchState() {
  const teams = await dbAll('SELECT * FROM teams ORDER BY name');
  const players = await dbAll('SELECT p.*, t.name AS team_name, t.logo AS team_logo FROM players p LEFT JOIN teams t ON p.team_id = t.id ORDER BY p.name');
  const matches = sanitizeMatchRows(await dbAll(`
    SELECT m.*, 
      ht.name AS home_team_name,
      ht.logo AS home_team_logo,
      at.name AS away_team_name,
      at.logo AS away_team_logo
    FROM matches m
    LEFT JOIN teams ht ON m.home_team_id = ht.id
    LEFT JOIN teams at ON m.away_team_id = at.id
    ORDER BY CASE m.status WHEN 'LIVE' THEN 0 WHEN 'SCHEDULED' THEN 1 WHEN 'HT' THEN 2 ELSE 3 END, m.date ASC
  `));
  const playerStats = await dbAll(`
    SELECT s.*, p.name AS player_name, p.position, p.number, p.team_id
    FROM match_player_stats s
    LEFT JOIN players p ON s.player_id = p.id
    ORDER BY s.match_id, p.name
  `);
  const events = await dbAll(`
    SELECT e.*, p.name AS player_name, rp.name AS related_player_name, ap.name AS assist_player_name
    FROM match_events e
    LEFT JOIN players p ON e.player_id = p.id
    LEFT JOIN players rp ON e.related_player_id = rp.id
    LEFT JOIN players ap ON e.assist_player_id = ap.id
    ORDER BY e.timestamp_seconds ASC, e.created_at ASC
  `);
  const lineups = await dbAll(`
    SELECT l.*, p.name AS player_name, p.position, p.number, p.team_id, t.name AS team_name
    FROM match_lineups l
    LEFT JOIN players p ON l.player_id = p.id
    LEFT JOIN teams t ON p.team_id = t.id
    ORDER BY l.match_id, CASE l.role WHEN 'starter' THEN 0 WHEN 'substitute' THEN 1 ELSE 2 END, p.number ASC
  `);

  let match = null;
  let homeTeam = null;
  let awayTeam = null;
  let homeLineup = { starters: [], subs: [] };
  let awayLineup = { starters: [], subs: [] };
  let matchEvents = [];
  let possession = { home: 50, away: 50 };
  let mvp = null;

  let activeId = activeMatchId;
  if (!activeId && matches.length > 0) {
    const live = matches.find(m => ['LIVE', '1H', '2H', 'HT', 'half_time', 'in_progress', 'live'].includes((m.status || '').toUpperCase()));
    activeId = live ? live.id : matches[0].id;
  }

  if (activeId) {
    match = matches.find(m => m.id == activeId) || null;
    if (match) {
      homeTeam = teams.find(t => t.id == match.home_team_id) || null;
      awayTeam = teams.find(t => t.id == match.away_team_id) || null;
      
      matchEvents = events.filter(e => e.match_id == activeId);
      
      const activeLineups = lineups.filter(l => l.match_id == activeId);
      homeLineup = {
        starters: activeLineups.filter(l => l.team_id == match.home_team_id && l.role === 'starter').map(l => ({ id: l.player_id, name: l.player_name, jersey_number: l.number, position: l.position })),
        subs: activeLineups.filter(l => l.team_id == match.home_team_id && l.role === 'substitute').map(l => ({ id: l.player_id, name: l.player_name, jersey_number: l.number, position: l.position }))
      };
      awayLineup = {
        starters: activeLineups.filter(l => l.team_id == match.away_team_id && l.role === 'starter').map(l => ({ id: l.player_id, name: l.player_name, jersey_number: l.number, position: l.position })),
        subs: activeLineups.filter(l => l.team_id == match.away_team_id && l.role === 'substitute').map(l => ({ id: l.player_id, name: l.player_name, jersey_number: l.number, position: l.position }))
      };

      possession = {
        home: match.home_possession || 50,
        away: match.away_possession || 50
      };

      if (match.mvp_player_id) {
        const mvpPlayer = players.find(p => p.id == match.mvp_player_id);
        if (mvpPlayer) {
          const stats = playerStats.find(s => s.match_id == activeId && s.player_id == match.mvp_player_id) || {};
          mvp = {
            id: mvpPlayer.id,
            name: mvpPlayer.name,
            jersey_number: mvpPlayer.number,
            position: mvpPlayer.position,
            team: mvpPlayer.team_name,
            goals: stats.goals || 0,
            assists: stats.assists || 0,
            yellow_cards: stats.yellow_cards || 0,
            red_cards: stats.red_cards || 0,
            minutes_played: 90
          };
        }
      }
    }
  }

  return { teams, players, matches, playerStats, events, lineups, match, homeTeam, awayTeam, homeLineup, awayLineup, events: matchEvents, possession, mvp };
}

function broadcastState() {
  return fetchState().then(state => io.emit('state', state));
}

async function getMatch(id) {
  return dbGet('SELECT * FROM matches WHERE id = ?', id);
}

// ── Auth routes ─────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.setHeader('Set-Cookie', `${SESSION_TOKEN}=granted; Path=/; HttpOnly; SameSite=Strict`);
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_TOKEN}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  res.json({ success: true });
});

// ── Page routes ──────────────────────────────────────────────────────
app.get('/admin', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/scoreboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'scoreboard.html')));
app.get('/', (req, res) => res.redirect('/scoreboard'));

app.get('/api/state', async (req, res) => {
  res.json(await fetchState());
});

app.get('/api/teams', async (req, res) => {
  res.json(await dbAll('SELECT * FROM teams ORDER BY name'));
});

app.post('/api/teams', async (req, res) => {
  const { name, logo } = req.body;
  const result = await dbRun('INSERT INTO teams (name, logo) VALUES (?, ?)', name, logo || '');
  await broadcastState();
  res.json({ id: result.lastID, name, logo });
});

app.post('/api/teams-full', async (req, res) => {
  const { name, logo, players } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name is required' });

  try {
    const result = await dbRun('INSERT INTO teams (name, logo) VALUES (?, ?)', name, logo || '');
    const teamId = result.lastID;

    if (players && Array.isArray(players)) {
      for (const p of players) {
        if (p.name) {
          await dbRun(
            'INSERT INTO players (name, position, number, team_id) VALUES (?, ?, ?, ?)',
            p.name, p.position || 'Roster', p.number || null, teamId
          );
        }
      }
    }

    await broadcastState();
    res.json({ id: teamId, name, logo });
  } catch (err) {
    console.error('Error creating team with roster:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teams/:id', async (req, res) => {
  const { name, logo } = req.body;
  await dbRun('UPDATE teams SET name = ?, logo = ? WHERE id = ?', name, logo || '', req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.put('/api/teams/:id/players', async (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) {
    return res.status(400).json({ error: 'Players array is required' });
  }

  try {
    for (const p of players) {
      if (p.id) {
        await dbRun(
          'UPDATE players SET name = ?, position = ?, number = ? WHERE id = ? AND team_id = ?',
          p.name, p.position || 'Roster', p.number || null, p.id, req.params.id
        );
      } else if (p.name) {
        await dbRun(
          'INSERT INTO players (name, position, number, team_id) VALUES (?, ?, ?, ?)',
          p.name, p.position || 'Roster', p.number || null, req.params.id
        );
      }
    }
    await broadcastState();
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating team roster:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  await dbRun('DELETE FROM teams WHERE id = ?', req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.get('/api/players', async (req, res) => {
  res.json(await dbAll('SELECT * FROM players ORDER BY name'));
});

app.post('/api/players', async (req, res) => {
  const { name, position, number, team_id } = req.body;
  const result = await dbRun('INSERT INTO players (name, position, number, team_id) VALUES (?, ?, ?, ?)', name, position || '', number || null, team_id || null);
  await broadcastState();
  res.json({ id: result.lastID, name, position, number, team_id });
});

app.put('/api/players/:id', async (req, res) => {
  const { name, position, number, team_id } = req.body;
  await dbRun('UPDATE players SET name = ?, position = ?, number = ?, team_id = ? WHERE id = ?', name, position || '', number || null, team_id || null, req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.delete('/api/players/:id', async (req, res) => {
  await dbRun('DELETE FROM players WHERE id = ?', req.params.id);
  await dbRun('DELETE FROM match_player_stats WHERE player_id = ?', req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.get('/api/matches', async (req, res) => {
  res.json(await fetchState().then(s => s.matches));
});

app.post('/api/matches', async (req, res) => {
  const { home_team_id, away_team_id, venue, date, referee, status } = req.body;
  const result = await dbRun(
    'INSERT INTO matches (home_team_id, away_team_id, venue, date, referee, status) VALUES (?, ?, ?, ?, ?, ?)',
    home_team_id, away_team_id, venue || '', date || '', referee || '', status || 'SCHEDULED'
  );
  await broadcastState();
  res.json({ id: result.lastID });
});

app.put('/api/matches/:id', async (req, res) => {
  const {
    home_team_id, away_team_id, venue, date, referee, status, match_time_seconds, timer_running,
    home_score, away_score, home_yellow, away_yellow, home_red, away_red, home_corners, away_corners,
    home_shots, away_shots, home_fouls, away_fouls, home_possession, away_possession, mvp_player_id
  } = req.body;
  await dbRun(`
    UPDATE matches SET
      home_team_id = ?, away_team_id = ?, venue = ?, date = ?, referee = ?, status = ?, match_time_seconds = ?, timer_running = ?,
      home_score = ?, away_score = ?, home_yellow = ?, away_yellow = ?, home_red = ?, away_red = ?, home_corners = ?, away_corners = ?,
      home_shots = ?, away_shots = ?, home_fouls = ?, away_fouls = ?, home_possession = ?, away_possession = ?, mvp_player_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    home_team_id, away_team_id, venue || '', date || '', referee || '', status || 'SCHEDULED', match_time_seconds || 0, timer_running ? 1 : 0,
    home_score || 0, away_score || 0, home_yellow || 0, away_yellow || 0, home_red || 0, away_red || 0, home_corners || 0, away_corners || 0,
    home_shots || 0, away_shots || 0, home_fouls || 0, away_fouls || 0, home_possession || 50, away_possession || 50, mvp_player_id || null,
    req.params.id
  );
  await broadcastState();
  res.json({ success: true });
});

app.delete('/api/matches/:id', async (req, res) => {
  await dbRun('DELETE FROM matches WHERE id = ?', req.params.id);
  await dbRun('DELETE FROM match_events WHERE match_id = ?', req.params.id);
  await dbRun('DELETE FROM match_lineups WHERE match_id = ?', req.params.id);
  await dbRun('DELETE FROM match_player_stats WHERE match_id = ?', req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.post('/api/select-match', async (req, res) => {
  const { matchId } = req.body;
  activeMatchId = Number(matchId) || null;
  await broadcastState();
  res.json({ success: true, activeMatchId });
});

app.put('/api/matches/:id/status', async (req, res) => {
  const { status } = req.body;
  const match = await getMatch(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const updates = ['status = ?'];
  const values = [status];
  const normalizedStatus = (status || '').toLowerCase();

  if (['1h', '2h'].includes(normalizedStatus)) {
    updates.push('timer_running = 1');
    if (normalizedStatus === '2h' && Number(match.match_time_seconds || 0) < 2700) {
      updates.push('match_time_seconds = 2700');
    }
  } else if (normalizedStatus === 'half_time') {
    updates.push('timer_running = 0');
    if (Number(match.match_time_seconds || 0) < 2700) {
      updates.push('match_time_seconds = 2700');
    }
  } else if (normalizedStatus === 'full_time') {
    updates.push('timer_running = 0');
    if (Number(match.match_time_seconds || 0) < 5400) {
      updates.push('match_time_seconds = 5400');
    }
  } else {
    updates.push('timer_running = 0');
  }

  const sql = `UPDATE matches SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  values.push(req.params.id);
  await dbRun(sql, ...values);
  await broadcastState();
  res.json({ success: true });
});

app.put('/api/matches/:id/score', async (req, res) => {
  const { home_score, away_score } = req.body;
  const match = await getMatch(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const hs = home_score !== undefined ? home_score : match.home_score;
  const as = away_score !== undefined ? away_score : match.away_score;
  await dbRun('UPDATE matches SET home_score = ?, away_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', hs, as, req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.put('/api/matches/:id/possession', async (req, res) => {
  const { home, away } = req.body;
  await dbRun('UPDATE matches SET home_possession = ?, away_possession = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', home, away, req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.put('/api/matches/:id/mvp', async (req, res) => {
  const { mvp_player_id } = req.body;
  await dbRun('UPDATE matches SET mvp_player_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', mvp_player_id || null, req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.post('/api/matches/:id/events', async (req, res) => {
  const { type, minute } = req.body;
  const match = await getMatch(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Resolve team side ('home' or 'away')
  let team = req.body.team;
  if (!team && req.body.team_id) {
    team = (Number(req.body.team_id) === Number(match.home_team_id)) ? 'home' : 'away';
  }
  if (!team) team = 'home';

  const teamId = team === 'home' ? match.home_team_id : match.away_team_id;

  // Resolve player_id from name
  let player_id = req.body.player_id || null;
  if (!player_id && req.body.player_name) {
    const pRow = await dbGet('SELECT id FROM players WHERE name = ? AND team_id = ?', req.body.player_name.trim(), teamId);
    if (pRow) player_id = pRow.id;
  }

  // Resolve assist_player_id from name
  let assist_player_id = req.body.assist_player_id || null;
  if (!assist_player_id && req.body.assist_player_name) {
    const pRow = await dbGet('SELECT id FROM players WHERE name = ? AND team_id = ?', req.body.assist_player_name.trim(), teamId);
    if (pRow) assist_player_id = pRow.id;
  }

  const timestamp_seconds = minute ? (minute * 60) : (req.body.timestamp_seconds || match.match_time_seconds || 0);
  const description = req.body.description || '';

  await dbRun(
    'INSERT INTO match_events (match_id, type, team, player_id, related_player_id, assist_player_id, description, timestamp_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    req.params.id, type, team, player_id, req.body.related_player_id || null, assist_player_id, description, timestamp_seconds
  );

  if (type === 'goal' || type === 'own_goal') {
    const scoreField = (type === 'goal')
      ? (team === 'home' ? 'home_score' : 'away_score')
      : (team === 'home' ? 'away_score' : 'home_score');
    const newScore = (match[scoreField] || 0) + 1;
    await dbRun(`UPDATE matches SET ${scoreField} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, newScore, req.params.id);
    if (player_id && type === 'goal') {
      const stat = await dbGet('SELECT * FROM match_player_stats WHERE match_id = ? AND player_id = ?', req.params.id, player_id);
      if (stat) {
        await dbRun('UPDATE match_player_stats SET goals = goals + 1 WHERE id = ?', stat.id);
      } else {
        await dbRun('INSERT INTO match_player_stats (match_id, player_id, goals) VALUES (?, ?, ?)', req.params.id, player_id, 1);
      }
    }
    if (assist_player_id && type === 'goal') {
      const assistStat = await dbGet('SELECT * FROM match_player_stats WHERE match_id = ? AND player_id = ?', req.params.id, assist_player_id);
      if (assistStat) {
        await dbRun('UPDATE match_player_stats SET assists = assists + 1 WHERE id = ?', assistStat.id);
      } else {
        await dbRun('INSERT INTO match_player_stats (match_id, player_id, assists) VALUES (?, ?, ?)', req.params.id, assist_player_id, 1);
      }
    }
  }
  if (['yellow', 'yellow_card', 'red', 'red_card', 'corner', 'foul', 'shot'].includes(type)) {
    let field = null;
    if (type === 'yellow' || type === 'yellow_card') field = `${team}_yellow`;
    else if (type === 'red' || type === 'red_card') field = `${team}_red`;
    else if (type === 'corner') field = `${team}_corners`;
    else if (type === 'foul') field = `${team}_fouls`;
    else if (type === 'shot') field = `${team}_shots`;

    if (field) {
      await dbRun(`UPDATE matches SET ${field} = ? WHERE id = ?`, (match[field] || 0) + 1, req.params.id);
    }

    if (player_id && ['yellow', 'yellow_card', 'red', 'red_card'].includes(type)) {
      const stat = await dbGet('SELECT * FROM match_player_stats WHERE match_id = ? AND player_id = ?', req.params.id, player_id);
      const updateField = (type === 'yellow' || type === 'yellow_card') ? 'yellow_cards' : 'red_cards';
      if (stat) {
        await dbRun(`UPDATE match_player_stats SET ${updateField} = ${updateField} + 1 WHERE id = ?`, stat.id);
      } else {
        await dbRun(`INSERT INTO match_player_stats (match_id, player_id, ${updateField}) VALUES (?, ?, 1)`, req.params.id, player_id);
      }
    }
  }

  await broadcastState();
  res.json({ success: true });
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    const event = await dbGet('SELECT * FROM match_events WHERE id = ?', req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    await dbRun('DELETE FROM match_events WHERE id = ?', req.params.id);

    const match = await getMatch(event.match_id);
    if (match) {
      let updateField = null;
      if (event.type === 'goal') {
        updateField = event.team === 'home' ? 'home_score' : 'away_score';
      } else if (event.type === 'own_goal') {
        updateField = event.team === 'home' ? 'away_score' : 'home_score';
      } else if (event.type === 'yellow' || event.type === 'yellow_card') {
        updateField = event.team === 'home' ? 'home_yellow' : 'away_yellow';
      } else if (event.type === 'red' || event.type === 'red_card') {
        updateField = event.team === 'home' ? 'home_red' : 'away_red';
      } else if (event.type === 'corner') {
        updateField = event.team === 'home' ? 'home_corners' : 'away_corners';
      } else if (event.type === 'foul') {
        updateField = event.team === 'home' ? 'home_fouls' : 'away_fouls';
      } else if (event.type === 'shot') {
        updateField = event.team === 'home' ? 'home_shots' : 'away_shots';
      }

      if (updateField) {
        const newVal = Math.max(0, (match[updateField] || 0) - 1);
        await dbRun(`UPDATE matches SET ${updateField} = ? WHERE id = ?`, newVal, event.match_id);
      }

      if (event.player_id) {
        const playerStat = await dbGet('SELECT * FROM match_player_stats WHERE match_id = ? AND player_id = ?', event.match_id, event.player_id);
        if (playerStat) {
          let statField = null;
          if (event.type === 'goal') statField = 'goals';
          else if (event.type === 'yellow' || event.type === 'yellow_card') statField = 'yellow_cards';
          else if (event.type === 'red' || event.type === 'red_card') statField = 'red_cards';

          if (statField) {
            const newVal = Math.max(0, (playerStat[statField] || 0) - 1);
            await dbRun(`UPDATE match_player_stats SET ${statField} = ? WHERE id = ?`, newVal, playerStat.id);
          }
        }
      }

      if (event.type === 'goal' && event.assist_player_id) {
        const assistStat = await dbGet('SELECT * FROM match_player_stats WHERE match_id = ? AND player_id = ?', event.match_id, event.assist_player_id);
        if (assistStat) {
          const newVal = Math.max(0, (assistStat.assists || 0) - 1);
          await dbRun(`UPDATE match_player_stats SET assists = ? WHERE id = ?`, newVal, assistStat.id);
        }
      }
    }

    await broadcastState();
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/matches/:id/lineup', async (req, res) => {
  const { player_id, role } = req.body;
  const existing = await dbGet('SELECT * FROM match_lineups WHERE match_id = ? AND player_id = ?', req.params.id, player_id);
  if (existing) {
    await dbRun('UPDATE match_lineups SET role = ? WHERE id = ?', role, existing.id);
  } else {
    await dbRun('INSERT INTO match_lineups (match_id, player_id, role) VALUES (?, ?, ?)', req.params.id, player_id, role || 'substitute');
  }
  await broadcastState();
  res.json({ success: true });
});

app.delete('/api/matches/:id/lineup/:lineupId', async (req, res) => {
  await dbRun('DELETE FROM match_lineups WHERE id = ? AND match_id = ?', req.params.lineupId, req.params.id);
  await broadcastState();
  res.json({ success: true });
});

app.post('/api/matches/:id/timer', async (req, res) => {
  const match = await getMatch(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const action = req.body.action;
  let update = {};
  if (action === 'start') {
    update.timer_running = 1;
    const currentStatus = (match.status || '').toLowerCase();
    if (['scheduled', 'not_started', ''].includes(currentStatus)) {
      update.status = '1h';
    }
  } else if (action === 'stop') {
    update.timer_running = 0;
  } else if (action === 'reset') {
    update.match_time_seconds = 0;
    update.timer_running = 0;
  } else if (action === 'set') {
    update.match_time_seconds = Math.max(0, Number(req.body.seconds) || 0);
  } else {
    return res.status(400).json({ error: 'Invalid timer action' });
  }

  const fields = Object.keys(update);
  if (fields.length > 0) {
    const values = fields.map(key => update[key]);
    const assignments = fields.map(key => `${key} = ?`).join(', ');
    values.push(req.params.id);
    await dbRun(`UPDATE matches SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
  }

  await broadcastState();
  res.json({ success: true });
});

app.post('/api/matches/:id/action', async (req, res) => {
  const { type, team, delta, minutes, player_id } = req.body;
  const match = await getMatch(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  let update = {};
  if (type === 'score') {
    if (team === 'home') update.home_score = (match.home_score || 0) + (delta || 1);
    if (team === 'away') update.away_score = (match.away_score || 0) + (delta || 1);
  }
  if (type === 'card') {
    if (team === 'home') {
      if (delta === 1 && req.body.card === 'yellow') update.home_yellow = (match.home_yellow || 0) + 1;
      if (delta === 1 && req.body.card === 'red') update.home_red = (match.home_red || 0) + 1;
      if (delta === -1 && req.body.card === 'yellow') update.home_yellow = Math.max(0, (match.home_yellow || 0) - 1);
      if (delta === -1 && req.body.card === 'red') update.home_red = Math.max(0, (match.home_red || 0) - 1);
    }
    if (team === 'away') {
      if (delta === 1 && req.body.card === 'yellow') update.away_yellow = (match.away_yellow || 0) + 1;
      if (delta === 1 && req.body.card === 'red') update.away_red = (match.away_red || 0) + 1;
      if (delta === -1 && req.body.card === 'yellow') update.away_yellow = Math.max(0, (match.away_yellow || 0) - 1);
      if (delta === -1 && req.body.card === 'red') update.away_red = Math.max(0, (match.away_red || 0) - 1);
    }
  }
  if (type === 'corner') {
    if (team === 'home') update.home_corners = Math.max(0, (match.home_corners || 0) + (delta || 1));
    if (team === 'away') update.away_corners = Math.max(0, (match.away_corners || 0) + (delta || 1));
  }
  if (type === 'foul') {
    if (team === 'home') update.home_fouls = Math.max(0, (match.home_fouls || 0) + (delta || 1));
    if (team === 'away') update.away_fouls = Math.max(0, (match.away_fouls || 0) + (delta || 1));
  }
  if (type === 'shot') {
    if (team === 'home') update.home_shots = Math.max(0, (match.home_shots || 0) + (delta || 1));
    if (team === 'away') update.away_shots = Math.max(0, (match.away_shots || 0) + (delta || 1));
  }
  if (type === 'timer') {
    if (req.body.action === 'start') {
      update.timer_running = 1;
      // Only auto-set status if the match is still scheduled/not started
      const currentStatus = (match.status || '').toLowerCase();
      if (['scheduled', 'not_started', ''].includes(currentStatus)) {
        update.status = '1h';
      }
    }
    if (req.body.action === 'stop') {
      update.timer_running = 0;
    }
    if (req.body.action === 'reset') {
      update.match_time_seconds = 0;
      update.timer_running = 0;
    }
    if (req.body.action === 'set') {
      update.match_time_seconds = Math.max(0, Number(req.body.seconds) || 0);
    }
  }
  if (req.body.action === 'status') {
    update.status = req.body.status;
  }

  const fields = Object.keys(update);
  if (fields.length > 0) {
    const values = fields.map(key => update[key]);
    const assignments = fields.map(key => `${key} = ?`).join(', ');
    values.push(req.params.id);
    await dbRun(`UPDATE matches SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
  }

  if (player_id && type === 'score') {
    const stat = await dbGet('SELECT * FROM match_player_stats WHERE match_id = ? AND player_id = ?', req.params.id, player_id);
    if (stat) {
      await dbRun('UPDATE match_player_stats SET goals = goals + 1 WHERE id = ?', stat.id);
    } else {
      await dbRun('INSERT INTO match_player_stats (match_id, player_id, goals) VALUES (?, ?, ?)', req.params.id, player_id, 1);
    }
  }

  await broadcastState();
  res.json({ success: true });
});

app.post('/api/matches/:id/players', async (req, res) => {
  const { player_id, goals, yellow_cards, red_cards } = req.body;
  const existing = await dbGet('SELECT * FROM match_player_stats WHERE match_id = ? AND player_id = ?', req.params.id, player_id);
  if (existing) {
    await dbRun(
      'UPDATE match_player_stats SET goals = ?, yellow_cards = ?, red_cards = ? WHERE id = ?',
      goals || existing.goals, yellow_cards || existing.yellow_cards, red_cards || existing.red_cards, existing.id
    );
  } else {
    await dbRun(
      'INSERT INTO match_player_stats (match_id, player_id, goals, yellow_cards, red_cards) VALUES (?, ?, ?, ?, ?)',
      req.params.id, player_id, goals || 0, yellow_cards || 0, red_cards || 0
    );
  }
  await broadcastState();
  res.json({ success: true });
});

app.get('/api/matches/:id/players', async (req, res) => {
  const stats = await dbAll(`
    SELECT s.*, p.name AS player_name, p.position, p.number, p.team_id
    FROM match_player_stats s
    LEFT JOIN players p ON s.player_id = p.id
    WHERE s.match_id = ?
    ORDER BY p.name
  `, req.params.id);
  res.json(stats);
});

io.on('connection', async socket => {
  socket.emit('state', await fetchState());
});

setInterval(async () => {
  // Tick whenever timer_running = 1, regardless of status string
  const liveMatches = await dbAll('SELECT id, match_time_seconds, status FROM matches WHERE timer_running = 1');
  if (!liveMatches.length) return;
  const updates = liveMatches.map(async match => {
    const currentSeconds = Number(match.match_time_seconds || 0);
    const nextSeconds = currentSeconds + 1;
    let sql = 'UPDATE matches SET match_time_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    let params = [nextSeconds, match.id];
    const status = (match.status || '').toLowerCase();

    if (currentSeconds < 2700 && nextSeconds >= 2700 && ['live', 'in_progress', '1h'].includes(status)) {
      sql = 'UPDATE matches SET match_time_seconds = ?, status = ?, timer_running = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      params = [2700, 'half_time', match.id];
    } else if (currentSeconds < 5400 && nextSeconds >= 5400 && status === '2h') {
      sql = 'UPDATE matches SET match_time_seconds = ?, status = ?, timer_running = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      params = [5400, 'full_time', match.id];
    }

    return dbRun(sql, ...params);
  });
  await Promise.all(updates);
  await broadcastState();
}, 1000);

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Football scoreboard server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database', err);
  process.exit(1);
});
