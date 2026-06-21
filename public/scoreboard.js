/* ─────────────────────────────────────────────────────────────────
   scoreboard.js  –  Match Center real-time logic (Black/Blue/Gold)
   ───────────────────────────────────────────────────────────────── */

const socket = io();

/* ── helpers ── */
const el = id => document.getElementById(id);
const setText = (id, v) => { const e = el(id); if (e) e.textContent = v ?? '—'; };

function animateScoreChange(id) {
  const target = el(id);
  if (!target) return;
  target.classList.remove('goal-update');
  void target.offsetWidth;
  target.classList.add('goal-update');
}

function setBar(homeId, awayId, homeVal, awayVal) {
  const total = (homeVal + awayVal) || 1;
  const hp = Math.round((homeVal / total) * 100);
  const ap = 100 - hp;
  const hEl = el(homeId); const aEl = el(awayId);
  if (hEl) hEl.style.width = hp + '%';
  if (aEl) aEl.style.width = ap + '%';
}

function renderMatchSelector(state) {
  const sel = el('matchSelectorDropdown');
  if (!sel) return;

  const activeId = state.match?.id || '';
  const currentValue = sel.value;
  sel.innerHTML = '';

  if (!state.matches || !state.matches.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— No matches available —';
    sel.appendChild(empty);
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Select Match —';
  sel.appendChild(placeholder);

  state.matches.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.home_team_name || '?'} vs ${m.away_team_name || '?'}${m.match_date ? ' — ' + new Date(m.match_date).toLocaleString() : ''}`;
    if (m.id == activeId) opt.selected = true;
    sel.appendChild(opt);
  });

  if (activeId) {
    sel.value = activeId;
  } else if (currentValue && state.matches.some(m => String(m.id) === currentValue)) {
    sel.value = currentValue;
  }
}

const EVENT_ICONS = {
  goal:        '⚽',
  own_goal:    '⚽🔴',
  yellow_card: '🟨',
  red_card:    '🟥',
  substitution:'🔄',
  corner:      '⭕',
  foul:        '⚠️',
  penalty:     '🎯',
  offside:     '🚩',
  save:        '🧤',
  shot:        '🎯',
};

/* ── badge class helper ── */
function badgeClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'live': case 'in_progress': case '1h': case '2h': return 'badge-live';
    case 'half_time':    return 'badge-ht';
    case 'full_time': case 'finished': return 'badge-ft';
    default:             return 'badge-sched';
  }
}
function badgeLabel(status) {
  switch ((status || '').toLowerCase()) {
    case 'live': case 'in_progress': return 'LIVE';
    case '1h':          return '1ST HALF';
    case '2h':          return '2ND HALF';
    case 'half_time':   return 'HALF TIME';
    case 'full_time': case 'finished': return 'FULL TIME';
    default:            return 'SCHEDULED';
  }
}

/* ── Format scorers list ── */
function buildScorerList(events, teamId) {
  const goals = (events || []).filter(e =>
    e.type === 'goal' && e.team_id == teamId
  );
  const own = (events || []).filter(e =>
    e.type === 'own_goal' && e.team_id != teamId
  );
  return [...goals, ...own].map(e =>
    `<div class="scorer-item">${e.player_name ?? '?'} ${e.minute}'</div>`
  ).join('');
}

/* ── build timeline HTML ── */
function buildTimeline(events) {
  if (!events || !events.length) {
    return '<div class="tl-empty">No events recorded yet</div>';
  }
  return [...events].reverse().map(e => {
    const icon = EVENT_ICONS[e.type] || '●';
    return `
      <div class="tl-event">
        <span class="tl-time">${e.minute}'</span>
        <span class="tl-icon">${icon}</span>
        <div>
          <div class="tl-text">${e.player_name ?? '—'}</div>
          <div class="tl-sub">${(e.type || '').replace(/_/g,' ')}${e.assist_player_name ? ' · Assist: '+e.assist_player_name : ''}</div>
        </div>
      </div>`;
  }).join('');
}

/* ── build lineup HTML ── */
function buildLineup(players, cls) {
  if (!players || !players.length) return '<div class="empty-state">Lineup not set</div>';
  return players.map(p => `
    <div class="player-row">
      <span class="player-num">${p.jersey_number ?? '—'}</span>
      <span>${p.name}</span>
      ${p.position ? `<span class="player-pos">${p.position}</span>` : ''}
    </div>`).join('');
}

/* ── compute per-team stat counts ── */
function teamStatCounts(events, homeId, awayId) {
  const h = { shotsOnTarget: 0, corners: 0, fouls: 0, yellow: 0, red: 0 };
  const a = { shotsOnTarget: 0, corners: 0, fouls: 0, yellow: 0, red: 0 };
  (events || []).forEach(e => {
    const side = e.team_id == homeId ? h : a;
    if (e.type === 'shot' || e.type === 'goal' || e.type === 'penalty') side.shotsOnTarget++;
    if (e.type === 'corner')      side.corners++;
    if (e.type === 'foul')        side.fouls++;
    if (e.type === 'yellow_card') side.yellow++;
    if (e.type === 'red_card')    side.red++;
  });
  return { h, a };
}

/* ══════════════════════════════════════
   MAIN RENDER
══════════════════════════════════════ */
let lastState = null;

function render(state) {
  const prevState = lastState;
  lastState = state;
  renderMatchSelector(state);
  const m = state.match;

  /* No active match */
  if (!m) {
    setText('homeName',  '—');
    setText('awayName',  '—');
    setText('scoreHome', '0');
    setText('scoreAway', '0');
    setText('matchClock','—');
    setText('metaVenue', 'No match selected');
    setText('metaRef',   '—');
    setText('metaDate',  '—');
    el('statusBadge').className = 'status-badge badge-sched';
    el('statusBadge').textContent = 'NO MATCH';
    el('tickerText').textContent = 'Waiting for match to begin…';
    buildFixtureTable(state.matches || []);
    return;
  }

  const ht = state.homeTeam || {};
  const at = state.awayTeam || {};
  const events = state.events || [];
  const homeLineup = state.homeLineup || { starters: [], subs: [] };
  const awayLineup = state.awayLineup || { starters: [], subs: [] };

  /* Teams */
  setText('homeName', ht.name || 'Home');
  setText('awayName', at.name || 'Away');
  const homeLogo = el('homeLogo');
  const awayLogo = el('awayLogo');
  if (homeLogo) homeLogo.src = ht.logo || `https://placehold.co/80/080c14/1e6fff?text=${encodeURIComponent((ht.name||'H').slice(0,2))}`;
  if (awayLogo) awayLogo.src = at.logo || `https://placehold.co/80/080c14/d4af37?text=${encodeURIComponent((at.name||'A').slice(0,2))}`;

  /* Score */
  const currentHomeScore = m.home_score ?? 0;
  const currentAwayScore = m.away_score ?? 0;
  const previousHomeScore = prevState?.match?.home_score ?? 0;
  const previousAwayScore = prevState?.match?.away_score ?? 0;

  setText('scoreHome', currentHomeScore);
  setText('scoreAway', currentAwayScore);

  if (prevState?.match && Math.abs(currentHomeScore - previousHomeScore) === 1) animateScoreChange('scoreHome');
  if (prevState?.match && Math.abs(currentAwayScore - previousAwayScore) === 1) animateScoreChange('scoreAway');

  /* Clock */
  const clockEl = el('matchClock');
  const statusLower = (m.status || '').toLowerCase();
  if (['live', 'in_progress', '1h', '2h'].includes(statusLower)) {
    clockEl.textContent = formatClock(m.match_time_seconds || 0);
    clockEl.className = 'match-clock clock-live';
  } else if (statusLower === 'full_time' || statusLower === 'finished') {
    clockEl.textContent = '00:00';
    clockEl.className = 'match-clock clock-static';
  } else {
    clockEl.textContent = statusLower === 'half_time' ? 'HT' : '—';
    clockEl.className = 'match-clock clock-static';
  }

  /* Status badge */
  const badge = el('statusBadge');
  badge.className = `status-badge ${badgeClass(m.status)}`;
  badge.textContent = badgeLabel(m.status);

  /* Meta */
  setText('metaVenue', m.venue || '—');
  setText('metaRef',   m.referee || '—');
  setText('metaDate',  m.match_date ? new Date(m.match_date).toLocaleString() : '—');

  /* Scorers */
  el('homeScorers').innerHTML = buildScorerList(events, m.home_team_id);
  el('awayScorers').innerHTML = buildScorerList(events, m.away_team_id);

  /* Timeline */
  el('timelineList').innerHTML = buildTimeline(events);

  /* Stats */
  const { h, a } = teamStatCounts(events, m.home_team_id, m.away_team_id);
  const poss = state.possession || { home: 50, away: 50 };

  setText('statPossHome',  poss.home + '%');
  setText('statPossAway',  poss.away + '%');
  setBar('barPossHome', 'barPossAway', poss.home, poss.away);

  const sh = m.home_shots_on_target ?? h.shotsOnTarget;
  const sa = m.away_shots_on_target ?? a.shotsOnTarget;
  setText('statShotsHome', sh); setText('statShotsAway', sa);
  setBar('barShotsHome', 'barShotsAway', sh, sa);

  const ch = m.home_corners ?? h.corners;
  const ca = m.away_corners ?? a.corners;
  setText('statCornHome', ch); setText('statCornAway', ca);
  setBar('barCornHome', 'barCornAway', ch, ca);

  const fh = m.home_fouls ?? h.fouls;
  const fa = m.away_fouls ?? a.fouls;
  setText('statFoulsHome', fh); setText('statFoulsAway', fa);
  setBar('barFoulsHome', 'barFoulsAway', fh, fa);

  /* Cards summary strip */
  setText('homeYellow',  m.home_yellow_cards ?? h.yellow);
  setText('homeRed',     m.home_red_cards    ?? h.red);
  setText('homeCorners', ch);
  setText('awayYellow',  m.away_yellow_cards ?? a.yellow);
  setText('awayRed',     m.away_red_cards    ?? a.red);
  setText('awayCorners', ca);

  /* Lineups */
  setText('homeSquadTitle', (ht.name || 'Home') + ' Starting XI');
  setText('awaySquadTitle', (at.name || 'Away') + ' Starting XI');
  el('homeStartingList').innerHTML = buildLineup(homeLineup.starters);
  el('homeSubsList').innerHTML     = buildLineup(homeLineup.subs);
  el('awayStartingList').innerHTML = buildLineup(awayLineup.starters);
  el('awaySubsList').innerHTML     = buildLineup(awayLineup.subs);

  /* Ticker */
  const lastEv = events[events.length - 1];
  if (lastEv) {
    const icon = EVENT_ICONS[lastEv.type] || '●';
    el('tickerText').textContent =
      `${icon} ${lastEv.minute}' — ${lastEv.player_name ?? '—'} (${(lastEv.type||'').replace(/_/g,' ')})`;
  } else {
    el('tickerText').textContent = 'Match underway…';
  }

  /* MVP */
  const mvp = state.mvp || null;
  if (mvp) {
    el('mvpCard').style.display = 'block';
    setText('mvpName', mvp.name);
    setText('mvpJersey', mvp.jersey_number || '?');
    setText('mvpTeamPos', `${mvp.team || ''} · ${mvp.position || ''}`);
    setText('mvpGoals',   mvp.goals   ?? 0);
    setText('mvpAssists', mvp.assists ?? 0);
    setText('mvpCards',   (mvp.yellow_cards ?? 0) + (mvp.red_cards ?? 0));
    setText('mvpMins',    mvp.minutes_played ?? 0);
  } else {
    el('mvpCard').style.display = 'none';
  }

  /* Fixtures */
  buildFixtureTable(state.matches || [], m.id);
}

/* ── Fixture table ── */
function buildFixtureTable(matches, activeId) {
  const body = el('fixtureBody');
  if (!body) return;
  if (!matches.length) {
    body.innerHTML = '<tr><td colspan="4" style="color:var(--muted);padding:1rem">No fixtures scheduled</td></tr>';
    return;
  }
  body.innerHTML = matches.map(fix => {
    const isActive = fix.id == activeId;
    return `
      <tr style="${isActive ? 'background:rgba(30,111,255,0.06)' : ''}">
        <td>${fix.home_team_name || '?'} <strong style="opacity:0.4">vs</strong> ${fix.away_team_name || '?'}</td>
        <td style="color:var(--muted)">${fix.venue || '—'}</td>
        <td style="color:var(--muted)">${fix.match_date ? new Date(fix.match_date).toLocaleDateString() : '—'}</td>
        <td>
          <span class="status-badge ${badgeClass(fix.status)}" style="font-size:0.65rem;padding:0.2rem 0.6rem">
            ${badgeLabel(fix.status)}
          </span>
        </td>
      </tr>`;
  }).join('');
}

/* ── clock formatter ── */
function formatClock(totalSecs) {
  const m = Math.floor(totalSecs / 60).toString().padStart(2,'0');
  const s = (totalSecs % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

/* ── Socket.io ── */
socket.on('state', state => render(state));
socket.on('connect', () => {
  fetch('/api/state').then(r => r.json()).then(render).catch(console.error);
});

const matchSelector = el('matchSelectorDropdown');
if (matchSelector) {
  matchSelector.addEventListener('change', async function () {
    const matchId = this.value ? Number(this.value) : null;
    try {
      await fetch('/api/select-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId })
      });
    } catch (err) {
      console.error('Could not change selected match:', err);
    }
  });
}

/* initial fetch */
fetch('/api/state').then(r => r.json()).then(render).catch(console.error);

/* live clock tick — only ticks when timer_running is true */
setInterval(() => {
  if (!lastState || !lastState.match) return;
  const m = lastState.match;

  // Respect the timer_running flag set by admin
  if (!m.timer_running) return;

  const statusLower = (m.status || '').toLowerCase();
  if (!['live', 'in_progress', '1h', '2h'].includes(statusLower)) return;

  const clockEl = el('matchClock');
  if (!clockEl) return;

  // Increment match_time_seconds (the canonical field used by render())
  m.match_time_seconds = (m.match_time_seconds || 0) + 1;
  m.match_time = m.match_time_seconds; // keep alias in sync
  clockEl.textContent = formatClock(m.match_time_seconds);
}, 1000);
