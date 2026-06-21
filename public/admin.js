/* ═══════════════════════════════════════════════════════════════
   admin.js  –  Full Admin Panel Logic (Black / Blue / Gold)
   ═══════════════════════════════════════════════════════════════ */

const socket = io();

/* ── Helpers ── */
const el  = id => document.getElementById(id);
const q   = sel => document.querySelector(sel);

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/* ── State ── */
let allMatches  = [];
let allTeams    = [];
let activeMatchId = null;
let liveState   = null;
let lastState   = null;

/* ════════════════════════════════════════
   TOAST NOTIFICATIONS
════════════════════════════════════════ */
function toast(msg, type = 'info') {
  const area = el('toastArea');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  area.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ════════════════════════════════════════
   BUILD 11-ROW PLAYER TABLE
════════════════════════════════════════ */
const POSITIONS = ['GK','CB','LB','RB','DM','CM','LM','RM','AM','LW','RW','ST','CF','SS'];

function buildPlayerRows(tbodyId) {
  const tbody = el(tbodyId);
  tbody.innerHTML = '';
  for (let i = 1; i <= 11; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--muted);font-size:0.78rem;width:24px;text-align:center">${i}</td>
      <td><input class="f-input num-input" type="number" min="1" max="99"
           placeholder="${i}" value="${i}" data-field="jersey"></td>
      <td><input class="f-input" type="text" placeholder="Player ${i}" data-field="name"></td>
      <td>
        <select class="f-select" data-field="position" style="padding:0.35rem 0.5rem;font-size:0.8rem">
          ${i===1 ? '<option value="GK" selected>GK</option>' : '<option value="">—</option>'}
          ${POSITIONS.filter(p=>p!=='GK').map(p=>`<option value="${p}">${p}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="checkbox" data-field="is_sub" title="Mark as substitute"
               style="width:16px;height:16px;accent-color:var(--blue);cursor:pointer"
               ${i > 11 ? 'checked' : ''}>
      </td>`;
    tbody.appendChild(tr);
  }
}

/* ════════════════════════════════════════
   READ PLAYER ROWS FROM TABLE
════════════════════════════════════════ */
function readPlayers(tbodyId) {
  const rows = el(tbodyId).querySelectorAll('tr');
  return Array.from(rows).map(row => ({
    jersey_number: parseInt(row.querySelector('[data-field="jersey"]')?.value) || 0,
    name:          row.querySelector('[data-field="name"]')?.value?.trim() || '',
    position:      row.querySelector('[data-field="position"]')?.value || '',
    is_sub:        row.querySelector('[data-field="is_sub"]')?.checked ? 1 : 0,
  })).filter(p => p.name);
}

/* ════════════════════════════════════════
   INIT PLAYER TABLES
════════════════════════════════════════ */
buildPlayerRows('homePlayerRows');
buildPlayerRows('awayPlayerRows');

/* ════════════════════════════════════════
   LOGOUT
════════════════════════════════════════ */
el('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

/* ════════════════════════════════════════
   FETCH & RENDER MATCH LIST
════════════════════════════════════════ */
async function loadMatches() {
  try {
    const res  = await fetch('/api/matches');
    allMatches = await res.json();
    renderMatchSelector();
    renderMatchList();
  } catch (e) { toast('Failed to load matches', 'error'); }
}

function renderMatchSelector() {
  const sel = el('globalMatchSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select Match —</option>';
  allMatches.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.home_team_name || '?'} vs ${m.away_team_name || '?'} — ${m.match_date ? new Date(m.match_date).toLocaleDateString() : 'TBD'}`;
    if (m.id == cur) opt.selected = true;
    sel.appendChild(opt);
  });
  if (activeMatchId) sel.value = activeMatchId;
}

function pillClass(status) {
  if (!status) return 'pill-scheduled';
  if (['live','in_progress','1h','2h'].includes(status)) return 'pill-live';
  if (['full_time','finished'].includes(status)) return 'pill-ft';
  return 'pill-scheduled';
}
function pillLabel(status) {
  const m = { scheduled:'Scheduled', live:'LIVE', in_progress:'LIVE', '1h':'1st Half',
    '2h':'2nd Half', half_time:'Half Time', full_time:'Full Time', finished:'Finished' };
  return m[status] || status || 'Scheduled';
}

function renderMatchList() {
  const container = el('matchListContainer');
  if (!allMatches.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:0.85rem">No matches yet. Create one below.</div>';
    return;
  }
  container.innerHTML = allMatches.map(m => `
    <div class="match-item ${m.id == activeMatchId ? 'active' : ''}" data-mid="${m.id}">
      <div class="match-item-vs">
        ${m.home_team_name || '?'} <span style="opacity:0.4;font-size:0.85rem">vs</span> ${m.away_team_name || '?'}
      </div>
      <div class="match-item-meta">📍 ${m.venue || '—'} &nbsp;·&nbsp; 📅 ${m.match_date ? new Date(m.match_date).toLocaleString() : 'TBD'}</div>
      <span class="status-pill ${pillClass(m.status)}">${pillLabel(m.status)}</span>
      <button class="btn btn-outline btn-sm" onclick="selectMatch(${m.id})">Select</button>
      <button class="btn btn-danger btn-sm" onclick="deleteMatch(${m.id})">🗑</button>
    </div>`).join('');
}

/* ════════════════════════════════════════
   SELECT MATCH (make it active)
════════════════════════════════════════ */
async function selectMatch(id) {
  activeMatchId = id;
  el('globalMatchSelect').value = id;

  try {
    await fetch('/api/select-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: id })
    });
    const state = await fetch('/api/state').then(r => r.json());
    lastState = state;
    liveState = state;
    renderLivePanel(state);
    renderEventsLog(state);
    renderMvpDropdown(state);
    renderEditLineup(state);
    renderMatchList();
    toast('Match selected ✓', 'success');
  } catch (e) { toast('Failed to select match', 'error'); }
}
window.selectMatch = selectMatch;

/* ════════════════════════════════════════
   DELETE MATCH
════════════════════════════════════════ */
async function deleteMatch(id) {
  if (!confirm('Delete this match and all its events? This cannot be undone.')) return;
  try {
    await fetch(`/api/matches/${id}`, { method: 'DELETE' });
    if (activeMatchId == id) {
      activeMatchId = null;
      el('liveMatchDisplay').style.display = 'none';
      el('noMatchMsg').style.display = 'block';
    }
    toast('Match deleted', 'success');
    loadMatches();
  } catch (e) { toast('Delete failed', 'error'); }
}
window.deleteMatch = deleteMatch;

/* ════════════════════════════════════════
   GLOBAL MATCH SELECTOR CHANGE
════════════════════════════════════════ */
el('globalMatchSelect').addEventListener('change', function () {
  if (this.value) selectMatch(parseInt(this.value));
});

/* ════════════════════════════════════════
   LIVE PANEL RENDER
════════════════════════════════════════ */
/* ── Clock Formatter ── */
function formatClock(totalSecs) {
  const m = Math.floor(totalSecs / 60).toString().padStart(2,'0');
  const s = (totalSecs % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

/* ════════════════════════════════════════
   LIVE PANEL RENDER
   ════════════════════════════════════════ */

/* ── Update the SVG ring progress arc ── */
function updateTimerRing(secs) {
  const ring = el('timerRingFill');
  if (!ring) return;
  // Full match = 90 min = 5400 sec. Ring fills over 90 min.
  const pct    = Math.min(secs / 5400, 1);
  const circumference = 408; // 2 * PI * 65
  ring.style.strokeDashoffset = (circumference * (1 - pct)).toFixed(2);
}

/* ── Status label map ── */
const STATUS_LABELS = {
  scheduled: 'Scheduled',
  '1h': '1st Half ⚽',
  half_time: 'Half Time',
  '2h': '2nd Half ⚽',
  full_time: 'Full Time',
  finished: 'Finished'
};

function renderLivePanel(state) {
  liveState = state;
  const m  = state.match;
  const ht = state.homeTeam || {};
  const at = state.awayTeam || {};

  if (!m) {
    el('liveMatchDisplay').style.display = 'none';
    el('noMatchMsg').style.display = 'block';
    return;
  }

  el('liveMatchDisplay').style.display = 'block';
  el('noMatchMsg').style.display = 'none';

  el('liveMatchTitle').textContent   = `${ht.name || '?'} vs ${at.name || '?'}`;
  el('liveMatchMeta').textContent    = `📍 ${m.venue || '—'} · 📅 ${m.date ? new Date(m.date).toLocaleString() : (m.match_date ? new Date(m.match_date).toLocaleString() : 'TBD')}`;
  
  // Update Live Stats panel score and labels
  el('statHomeTeamLabel').textContent = ht.name || 'Home Team';
  el('statAwayTeamLabel').textContent = at.name || 'Away Team';
  el('liveHomeScore').textContent    = m.home_score ?? 0;
  el('liveAwayScore').textContent    = m.away_score ?? 0;
  
  // ── Timer widget (all with null guards so a missing element never throws) ──
  const secs      = m.match_time_seconds || 0;
  const isRunning = !!m.timer_running;

  const clockEl = el('liveMatchClock');
  if (clockEl) clockEl.textContent = formatClock(secs);
  updateTimerRing(secs);

  // Running class drives pulse + live dot animations
  const wrap = el('timerRingWrap');
  if (wrap) {
    if (isRunning) wrap.classList.add('timer-running');
    else           wrap.classList.remove('timer-running');
  }

  // Play / Pause button
  const btn   = el('timerStartPauseBtn');
  const label = el('timerBtnLabel');
  const icon  = el('timerPlayIcon');
  if (btn) {
    if (isRunning) btn.classList.add('btn-timer-pause');
    else           btn.classList.remove('btn-timer-pause');
  }
  if (label) label.textContent = isRunning ? 'Pause' : 'Play';
  if (icon) {
    icon.setAttribute('viewBox', '0 0 14 14');
    icon.setAttribute('fill', 'currentColor');
    if (isRunning) {
      // Pause icon: two vertical bars
      icon.innerHTML = '<rect x="2" y="1" width="4" height="12" rx="1"/><rect x="8" y="1" width="4" height="12" rx="1"/>';
    } else {
      // Play triangle
      icon.innerHTML = '<polygon points="2,1 13,7 2,13"/>';
    }
  }

  // Status label badge
  const statusLab = el('timerStatusLabel');
  if (statusLab) {
    statusLab.textContent = STATUS_LABELS[m.status] || m.status || 'Scheduled';
  }

  // Update live dot indicator
  const liveDot = el('timerLiveDot');
  if (liveDot) {
    if (isRunning) {
      liveDot.style.background = '#22c55e'; // Green
      liveDot.style.boxShadow = '0 0 10px #22c55e';
    } else {
      liveDot.style.background = '#ef4444'; // Red
      liveDot.style.boxShadow = 'none';
    }
  }

  const statusSel = el('statusSelect');
  if (statusSel) statusSel.value = m.status || 'scheduled';

  // Update Stats counts
  el('statHomeCorners').textContent = m.home_corners ?? 0;
  el('statAwayCorners').textContent = m.away_corners ?? 0;
  el('statHomeFouls').textContent = m.home_fouls ?? 0;
  el('statAwayFouls').textContent = m.away_fouls ?? 0;
  el('statHomeShots').textContent = m.home_shots ?? 0;
  el('statAwayShots').textContent = m.away_shots ?? 0;
  el('statHomeYellow').textContent = m.home_yellow ?? 0;
  el('statAwayYellow').textContent = m.away_yellow ?? 0;
  el('statHomeRed').textContent = m.home_red ?? 0;
  el('statAwayRed').textContent = m.away_red ?? 0;
}

function renderMvpDropdown(state) {
  const m  = state.match;
  const ht = state.homeTeam || {};
  const at = state.awayTeam || {};
  const mvpSel = el('mvpSelect');
  const allHome = [...(state.homeLineup?.starters || []), ...(state.homeLineup?.subs || [])];
  const allAway = [...(state.awayLineup?.starters || []), ...(state.awayLineup?.subs || [])];
  
  mvpSel.innerHTML = '<option value="">— Select MVP —</option>';
  if (allHome.length || allAway.length) {
    const ogHome = document.createElement('optgroup');
    ogHome.label = ht.name || 'Home';
    allHome.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `#${p.jersey_number || ''} ${p.name} (${p.position || '—'})`;
      ogHome.appendChild(opt);
    });
    mvpSel.appendChild(ogHome);

    const ogAway = document.createElement('optgroup');
    ogAway.label = at.name || 'Away';
    allAway.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `#${p.jersey_number || ''} ${p.name} (${p.position || '—'})`;
      ogAway.appendChild(opt);
    });
    mvpSel.appendChild(ogAway);
  }
  if (m && m.mvp_player_id) {
    mvpSel.value = m.mvp_player_id;
  }
}

function renderEventsLog(state) {
  const events = state.events || [];
  const ICONS  = { goal:'⚽', own_goal:'⚽🔴', yellow_card:'🟨', red_card:'🟥',
    substitution:'🔄', corner:'⭕', foul:'⚠️', penalty:'🎯', save:'🧤', shot:'🎯' };
  el('eventsLogTable').innerHTML = events.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:0.8rem">
         <thead><tr>
           <th style="text-align:left;padding:0.3rem 0.5rem;color:var(--muted);border-bottom:1px solid var(--border)">Min</th>
           <th style="text-align:left;padding:0.3rem 0.5rem;color:var(--muted);border-bottom:1px solid var(--border)">Type</th>
           <th style="text-align:left;padding:0.3rem 0.5rem;color:var(--muted);border-bottom:1px solid var(--border)">Player</th>
           <th style="padding:0.3rem 0.5rem;border-bottom:1px solid var(--border)"></th>
         </tr></thead>
         <tbody>
           ${[...events].reverse().map(ev => `
             <tr style="border-bottom:1px solid rgba(255,255,255,0.02)">
               <td style="padding:0.3rem 0.5rem;color:var(--blue)">${ev.minute}'</td>
               <td style="padding:0.3rem 0.5rem">${ICONS[ev.type]||'●'} ${(ev.type||'').replace(/_/g,' ')}</td>
               <td style="padding:0.3rem 0.5rem">${ev.player_name||'—'}</td>
               <td style="padding:0.3rem 0.5rem;text-align:right">
                 <button class="btn btn-danger btn-sm" onclick="deleteEvent(${ev.id})">✕</button>
               </td>
             </tr>`).join('')}
         </tbody>
       </table>`
    : '<div style="color:var(--muted);padding:0.5rem;font-size:0.82rem">No events yet</div>';
}

/* ════════════════════════════════════════
   UPDATE STATUS
════════════════════════════════════════ */
el('updateStatusBtn').addEventListener('click', async () => {
  if (!activeMatchId) return toast('No match selected', 'error');
  const status = el('statusSelect').value;
  try {
    await fetch(`/api/matches/${activeMatchId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    toast('Status updated ✓', 'success');
    loadMatches();
  } catch (e) { toast('Failed to update status', 'error'); }
});

/* ── Score & Stats Actions ── */
async function adjustStat(type, team, delta, cardType = null) {
  if (!activeMatchId) return toast('No match selected', 'error');
  try {
    const body = { type, team, delta };
    if (cardType) body.card = cardType;
    await fetch(`/api/matches/${activeMatchId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    toast('Stat updated ✓', 'success');
  } catch (e) {
    toast('Failed to update stat', 'error');
  }
}

/* ── Advanced Event Modal & Stat Logging ── */
function openEventModal(type, team) {
  if (!activeMatchId || !liveState) return toast('No active match selected', 'error');

  const modal = el('eventModal');
  const typeInput = el('modalEventType');
  const teamInput = el('modalTeamSide');
  const minInput = el('modalEventMinute');
  const playerSelect = el('modalEventPlayer');
  const assistSelect = el('modalEventAssist');
  const assistGroup = el('modalAssistGroup');
  const title = el('modalTitle');
  const playerLabel = el('modalPlayerLabel');

  typeInput.value = type;
  teamInput.value = team;

  // Pre-fill minute based on running timer
  const matchTimeSecs = liveState.match?.match_time_seconds || 0;
  const currentMin = Math.max(1, Math.floor(matchTimeSecs / 60) + 1);
  minInput.value = currentMin;

  const teamName = team === 'home' ? (liveState.homeTeam?.name || 'Home') : (liveState.awayTeam?.name || 'Away');
  
  const TYPE_LABELS = {
    goal: '⚽ Record Goal',
    yellow_card: '🟨 Record Yellow Card',
    red_card: '🟥 Record Red Card',
    corner: '⭕ Record Corner',
    foul: '⚠️ Record Foul',
    shot: '🎯 Record Shot on Target'
  };
  title.textContent = `${TYPE_LABELS[type] || 'Record Event'} — ${teamName}`;
  playerLabel.textContent = type === 'goal' ? 'Scored By' : 'Player';

  // Toggle assist selector
  if (type === 'goal') {
    assistGroup.style.display = 'block';
  } else {
    assistGroup.style.display = 'none';
  }

  // Populate players
  const lineup = team === 'home' ? liveState.homeLineup : liveState.awayLineup;
  const starters = lineup?.starters || [];
  const subs = lineup?.subs || [];
  const allPlayers = [...starters, ...subs];

  // Scorer dropdown
  playerSelect.innerHTML = `<option value="">— Unknown / Team Event —</option>`;
  if (type === 'goal') {
    playerSelect.innerHTML += `<option value="own_goal">🚨 Own Goal (Opponent Point)</option>`;
  }

  allPlayers.forEach(p => {
    playerSelect.innerHTML += `<option value="${p.id}">${p.jersey_number ? '#' + p.jersey_number : ''} ${p.name} (${p.position || '—'})</option>`;
  });

  // Assist dropdown
  const updateAssistOptions = (scorerId) => {
    assistSelect.innerHTML = `<option value="">— None —</option>`;
    allPlayers.forEach(p => {
      if (p.id != scorerId) {
        assistSelect.innerHTML += `<option value="${p.id}">${p.jersey_number ? '#' + p.jersey_number : ''} ${p.name} (${p.position || '—'})</option>`;
      }
    });
  };

  updateAssistOptions('');

  playerSelect.onchange = () => {
    updateAssistOptions(playerSelect.value);
  };

  modal.classList.add('active');
}

function closeEventModal() {
  el('eventModal').classList.remove('active');
}

async function saveEventModal() {
  const type = el('modalEventType').value;
  const team = el('modalTeamSide').value;
  const minute = parseInt(el('modalEventMinute').value) || 1;
  const playerVal = el('modalEventPlayer').value;
  const assistVal = el('modalEventAssist').value;

  if (!activeMatchId || !liveState) return;

  const match = liveState.match;
  const teamId = team === 'home' ? match.home_team_id : match.away_team_id;

  let eventType = type;
  let playerId = null;
  let playerName = null;
  let assistId = null;
  let assistName = null;

  const lineup = team === 'home' ? liveState.homeLineup : liveState.awayLineup;
  const allPlayers = [...(lineup?.starters || []), ...(lineup?.subs || [])];

  if (playerVal === 'own_goal') {
    eventType = 'own_goal';
  } else if (playerVal) {
    playerId = parseInt(playerVal);
    const pObj = allPlayers.find(p => p.id === playerId);
    if (pObj) playerName = pObj.name;
  }

  if (type === 'goal' && assistVal) {
    assistId = parseInt(assistVal);
    const pObj = allPlayers.find(p => p.id === assistId);
    if (pObj) assistName = pObj.name;
  }

  try {
    const res = await fetch(`/api/matches/${activeMatchId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: eventType,
        team,
        team_id: teamId,
        player_id: playerId,
        player_name: playerName,
        assist_player_id: assistId,
        assist_player_name: assistName,
        minute: minute
      })
    });

    if (!res.ok) throw new Error('API failed');

    toast('Event logged successfully ✓', 'success');
    closeEventModal();
  } catch (e) {
    toast('Failed to record event', 'error');
  }
}

async function decrementStat(type, team, cardType = null) {
  if (!activeMatchId || !liveState) return;
  const matchType = cardType ? `${cardType}_card` : type;
  
  // Find events matching this type and team
  const matchEvents = (liveState.events || []).filter(e => {
    const evType = e.type === 'yellow' ? 'yellow_card' : (e.type === 'red' ? 'red_card' : e.type);
    const targetType = matchType === 'yellow' ? 'yellow_card' : (matchType === 'red' ? 'red_card' : matchType);
    return evType === targetType && e.team === team;
  });
  
  if (matchEvents.length > 0) {
    // Delete the most recent one (last in array)
    const latest = matchEvents[matchEvents.length - 1];
    let label = latest.type.replace(/_/g, ' ');
    if (confirm(`Remove the most recent ${label} by ${latest.player_name || 'unknown/team'} at ${latest.minute}'?`)) {
      try {
        const res = await fetch(`/api/events/${latest.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        toast('Event removed ✓', 'success');
      } catch (e) {
        toast('Failed to remove event', 'error');
      }
    }
  } else {
    // If no events exist in log, fall back to direct adjustment of match stats (if they just want to decrement manual stats)
    adjustStat(type, team, -1, cardType);
  }
}

// Bind buttons to advanced functions
el('homeScoreUp').addEventListener('click',   () => openEventModal('goal', 'home'));
el('homeScoreDown').addEventListener('click', () => decrementStat('goal', 'home'));
el('awayScoreUp').addEventListener('click',   () => openEventModal('goal', 'away'));
el('awayScoreDown').addEventListener('click', () => decrementStat('goal', 'away'));

el('homeCornersUp').addEventListener('click',   () => openEventModal('corner', 'home'));
el('homeCornersDown').addEventListener('click', () => decrementStat('corner', 'home'));
el('awayCornersUp').addEventListener('click',   () => openEventModal('corner', 'away'));
el('awayCornersDown').addEventListener('click', () => decrementStat('corner', 'away'));

el('homeFoulsUp').addEventListener('click',   () => openEventModal('foul', 'home'));
el('homeFoulsDown').addEventListener('click', () => decrementStat('foul', 'home'));
el('awayFoulsUp').addEventListener('click',   () => openEventModal('foul', 'away'));
el('awayFoulsDown').addEventListener('click', () => decrementStat('foul', 'away'));

el('homeShotsUp').addEventListener('click',   () => openEventModal('shot', 'home'));
el('homeShotsDown').addEventListener('click', () => decrementStat('shot', 'home'));
el('awayShotsUp').addEventListener('click',   () => openEventModal('shot', 'away'));
el('awayShotsDown').addEventListener('click', () => decrementStat('shot', 'away'));

el('homeYellowUp').addEventListener('click',   () => openEventModal('yellow_card', 'home'));
el('homeYellowDown').addEventListener('click', () => decrementStat('card', 'home', 'yellow'));
el('awayYellowUp').addEventListener('click',   () => openEventModal('yellow_card', 'away'));
el('awayYellowDown').addEventListener('click', () => decrementStat('card', 'away', 'yellow'));

el('homeRedUp').addEventListener('click',   () => openEventModal('red_card', 'home'));
el('homeRedDown').addEventListener('click', () => decrementStat('card', 'home', 'red'));
el('awayRedUp').addEventListener('click',   () => openEventModal('red_card', 'away'));
el('awayRedDown').addEventListener('click', () => decrementStat('card', 'away', 'red'));

/* ── Timer Controls ── */
async function sendTimerAction(matchId, action, seconds = null) {
  const body = { action };
  if (seconds !== null) body.seconds = seconds;

  const res = await fetch(`/api/matches/${matchId}/timer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
  if (payload && payload.success === false) throw new Error(payload.error || 'Request failed');
  return payload;
}

const timerStartPauseButton = el('timerStartPauseBtn');
if (timerStartPauseButton) {
  timerStartPauseButton.style.display = 'none';
}

el('timerResetBtn').addEventListener('click', async () => {
  if (!activeMatchId) return toast('Select a match first', 'error');
  if (!confirm('Reset match timer to 00:00?')) return;
  // Optimistic update
  try {
    if (liveState?.match) {
      liveState.match.match_time_seconds = 0;
      liveState.match.timer_running = false;
      renderLivePanel(liveState);
    }
  } catch (_) {}
  try {
    await fetch(`/api/matches/${activeMatchId}/timer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' })
    });
    toast('↺ Timer reset to 00:00', 'info');
  } catch (e) { toast('Timer reset failed', 'error'); }
});

el('timerSetBtn').addEventListener('click', async () => {
  if (!activeMatchId) return toast('Select a match first', 'error');
  const mins = parseInt(el('timerSecondsInput').value) || 0;
  const secs = mins * 60;
  // Optimistic update
  try {
    if (liveState?.match) {
      liveState.match.match_time_seconds = secs;
      renderLivePanel(liveState);
    }
  } catch (_) {}
  try {
    await fetch(`/api/matches/${activeMatchId}/timer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', seconds: secs })
    });
    toast(`⏰ Timer set to ${mins} min${mins !== 1 ? 's' : ''}`, 'info');
  } catch (e) { toast('Set timer failed', 'error'); }
});

/* ── Quick-jump buttons ── */
async function quickJump(secs, statusOverride) {
  if (!activeMatchId) return toast('No match selected', 'error');
  // Optimistic update
  if (liveState?.match) {
    liveState.match.match_time_seconds = secs;
    if (statusOverride) liveState.match.status = statusOverride;
    renderLivePanel(liveState);
  }
  try {
    // Set time
    await fetch(`/api/matches/${activeMatchId}/timer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', seconds: secs })
    });
    // Set status if provided
    if (statusOverride) {
      await fetch(`/api/matches/${activeMatchId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusOverride })
      });
    }
    toast(`Jumped to ${Math.floor(secs/60)}'${statusOverride ? ' — ' + (STATUS_LABELS[statusOverride] || statusOverride) : ''}`, 'info');
  } catch (e) { toast('Quick jump failed', 'error'); }
}

el('quickBtn0').addEventListener('click',  () => quickJump(0));
el('quickBtn45').addEventListener('click', () => quickJump(45 * 60));
el('quickBtn90').addEventListener('click', () => quickJump(90 * 60));
el('quickBtnHT').addEventListener('click', () => quickJump(45 * 60, 'half_time'));
el('quickBtnFT').addEventListener('click', () => quickJump(90 * 60, 'full_time'));

/* ── Possession ── */
el('updatePossBtn').addEventListener('click', async () => {
  if (!activeMatchId) return toast('No match selected', 'error');
  const home = parseInt(el('possInput').value) || 50;
  const away = 100 - home;
  try {
    await fetch(`/api/matches/${activeMatchId}/possession`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ home, away })
    });
    toast(`Possession set ${home}% / ${away}%`, 'info');
  } catch (e) { toast('Failed', 'error'); }
});

/* ── MVP Update ── */
el('updateMvpBtn').addEventListener('click', async () => {
  if (!activeMatchId) return toast('No match selected', 'error');
  const mvpId = el('mvpSelect').value;
  try {
    await fetch(`/api/matches/${activeMatchId}/mvp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mvp_player_id: mvpId ? parseInt(mvpId) : null })
    });
    toast('MVP updated ✓', 'success');
  } catch (e) { toast('MVP update failed', 'error'); }
});

/* ════════════════════════════════════════
   LOG EVENT
════════════════════════════════════════ */
el('logEventBtn').addEventListener('click', async () => {
  if (!activeMatchId) return toast('No match selected', 'error');
  if (!liveState) return;

  const minute = parseInt(el('eventMinute').value);
  const type   = el('eventType').value;
  const side   = el('eventTeamSide').value;
  const player = el('eventPlayer').value.trim();
  const assist = el('eventAssist').value.trim();

  if (!minute || !player) return toast('Enter minute and player name', 'error');

  const teamId = side === 'home'
    ? liveState.match?.home_team_id
    : liveState.match?.away_team_id;

  try {
    await fetch(`/api/matches/${activeMatchId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type, minute, team_id: teamId,
        player_name: player,
        assist_player_name: assist || null
      })
    });
    el('eventMinute').value = '';
    el('eventPlayer').value = '';
    el('eventAssist').value = '';
    toast(`Event logged: ${type} ${minute}'`, 'success');
  } catch (e) { toast('Failed to log event', 'error'); }
});

/* Delete event */
async function deleteEvent(id) {
  if (!confirm('Remove this event?')) return;
  await fetch(`/api/events/${id}`, { method: 'DELETE' });
  toast('Event removed', 'success');
}
window.deleteEvent = deleteEvent;

/* ════════════════════════════════════════
   CREATE MATCH
════════════════════════════════════════ */
el('createMatchBtn').addEventListener('click', async () => {
  const homeTeamName = el('homeTeamName').value.trim();
  const awayTeamName = el('awayTeamName').value.trim();
  const venue        = el('newVenue').value.trim();
  const matchDate    = el('newDate').value;
  const referee      = el('newRef').value.trim();
  const homeLogoFile = el('homeTeamLogoFile').files[0];
  const awayLogoFile = el('awayTeamLogoFile').files[0];

  if (!homeTeamName || !awayTeamName) {
    return toast('Both team names are required', 'error');
  }
  if (homeLogoFile && !homeLogoFile.type.startsWith('image/')) {
    return toast('Home logo must be an image file', 'error');
  }
  if (awayLogoFile && !awayLogoFile.type.startsWith('image/')) {
    return toast('Away logo must be an image file', 'error');
  }

  const homeLogo = homeLogoFile ? await readFileAsDataUrl(homeLogoFile) : '';
  const awayLogo = awayLogoFile ? await readFileAsDataUrl(awayLogoFile) : '';
  const homePlayers = readPlayers('homePlayerRows');
  const awayPlayers = readPlayers('awayPlayerRows');

  el('createMatchBtn').disabled = true;
  el('createMatchBtn').textContent = '⏳ Creating…';

  try {
    // 1. Create or reuse Home team
    let homeTeam = allTeams.find(t => t.name.toLowerCase() === homeTeamName.toLowerCase());
    if (!homeTeam) {
      homeTeam = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: homeTeamName, logo: homeLogo })
      }).then(r => r.json());
    }

    // 2. Create or reuse Away team
    let awayTeam = allTeams.find(t => t.name.toLowerCase() === awayTeamName.toLowerCase());
    if (!awayTeam) {
      awayTeam = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: awayTeamName, logo: awayLogo })
      }).then(r => r.json());
    }

    // 3. Create Match
    const matchRes = await fetch('/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        venue, referee,
        match_date: matchDate || null,
        home_score: 0, away_score: 0, status: 'scheduled'
      })
    });
    const newMatch = await matchRes.json();

    // 4. Add players to Home team & lineup
    for (const p of homePlayers) {
      const pRes = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: homeTeam.id, name: p.name, position: p.position, number: p.jersey_number })
      }).then(r => r.json());

      await fetch(`/api/matches/${newMatch.id}/lineup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: pRes.id,
          role: p.is_sub ? 'substitute' : 'starter'
        })
      });
    }

    // 5. Add players to Away team & lineup
    for (const p of awayPlayers) {
      const pRes = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: awayTeam.id, name: p.name, position: p.position, number: p.jersey_number })
      }).then(r => r.json());

      await fetch(`/api/matches/${newMatch.id}/lineup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: pRes.id,
          role: p.is_sub ? 'substitute' : 'starter'
        })
      });
    }

    toast(`✅ Match created: ${homeTeamName} vs ${awayTeamName}`, 'success');
    clearMatchForm();
    await loadMatches();
    await loadTeams();
    selectMatch(newMatch.id);

  } catch (err) {
    console.error(err);
    toast('Failed to create match: ' + err.message, 'error');
  } finally {
    el('createMatchBtn').disabled = false;
    el('createMatchBtn').textContent = '🚀 Create Match';
  }
});

/* Clear form */
el('clearMatchFormBtn').addEventListener('click', clearMatchForm);
function clearMatchForm() {
  el('homeTeamName').value = '';
  el('awayTeamName').value = '';
  el('homeTeamLogoFile').value = '';
  el('awayTeamLogoFile').value = '';
  el('newVenue').value    = '';
  el('newDate').value     = '';
  el('newRef').value      = '';
  buildPlayerRows('homePlayerRows');
  buildPlayerRows('awayPlayerRows');
}

/* ════════════════════════════════════════
   EDIT LINEUP
════════════════════════════════════════ */
function renderEditLineup(state) {
  const container = el('editLineupContent');
  const m  = state.match;
  const ht = state.homeTeam || {};
  const at = state.awayTeam || {};
  const homeLineup = state.homeLineup || { starters: [], subs: [] };
  const awayLineup = state.awayLineup || { starters: [], subs: [] };

  if (!m) {
    container.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">Select an active match to edit its lineup.</p>';
    return;
  }

  const allHome = [...(homeLineup.starters || []), ...(homeLineup.subs || [])];
  const allAway = [...(awayLineup.starters || []), ...(awayLineup.subs || [])];

  function playerRow(p, teamColor) {
    return `<tr data-lineup-id="${p.lineup_id || ''}" data-player-id="${p.id || ''}">
      <td><input class="f-input num-input" type="number" value="${p.jersey_number||''}"
           data-field="jersey" style="padding:0.3rem 0.45rem;font-size:0.78rem"></td>
      <td><input class="f-input" type="text" value="${p.name||''}"
           data-field="name" style="padding:0.3rem 0.45rem;font-size:0.78rem"></td>
      <td>
        <select class="f-select" data-field="position" style="padding:0.3rem 0.45rem;font-size:0.78rem">
          ${['','GK','CB','LB','RB','DM','CM','LM','RM','AM','LW','RW','ST','CF','SS']
            .map(pos => `<option value="${pos}" ${p.position===pos?'selected':''}>${pos||'—'}</option>`).join('')}
        </select>
      </td>
      <td><input type="checkbox" ${p.is_sub?'checked':''} data-field="is_sub"
           style="width:16px;height:16px;accent-color:var(--blue);cursor:pointer" title="Sub"></td>
    </tr>`;
  }

  container.innerHTML = `
    <div class="a-grid-2">
      <div>
        <div class="squad-title-edit" style="font-family:'Outfit',sans-serif;font-size:0.9rem;font-weight:800;color:#7eb6ff;margin-bottom:0.5rem">
          🔵 ${ht.name || 'Home'} — Lineup
        </div>
        <table class="player-table" id="editHomeTable">
          <thead><tr>
            <th style="width:50px">#</th><th>Name</th><th>Pos</th><th>Sub</th>
          </tr></thead>
          <tbody>
            ${allHome.length ? allHome.map(p => playerRow(p,'home')).join('') : '<tr><td colspan="4" style="color:var(--muted);padding:0.5rem">No lineup set</td></tr>'}
          </tbody>
        </table>
      </div>
      <div>
        <div class="squad-title-edit" style="font-family:'Outfit',sans-serif;font-size:0.9rem;font-weight:800;color:var(--gold2);margin-bottom:0.5rem">
          🟡 ${at.name || 'Away'} — Lineup
        </div>
        <table class="player-table" id="editAwayTable">
          <thead><tr>
            <th style="width:50px">#</th><th>Name</th><th>Pos</th><th>Sub</th>
          </tr></thead>
          <tbody>
            ${allAway.length ? allAway.map(p => playerRow(p,'away')).join('') : '<tr><td colspan="4" style="color:var(--muted);padding:0.5rem">No lineup set</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div style="margin-top:1rem">
      <button class="btn btn-primary" id="saveLineupBtn">💾 Save Lineup Changes</button>
    </div>`;

  el('saveLineupBtn').addEventListener('click', () => saveLineupChanges(state, allHome, allAway));
}

async function saveLineupChanges(state, allHome, allAway) {
  const m  = state.match;
  if (!m) return;

  const readRows = (tableId) => {
    return Array.from(el(tableId).querySelectorAll('tbody tr')).map(row => ({
      lineup_id:     row.dataset.lineupId,
      player_id:     row.dataset.playerId,
      jersey_number: parseInt(row.querySelector('[data-field="jersey"]')?.value) || 0,
      name:          row.querySelector('[data-field="name"]')?.value?.trim() || '',
      position:      row.querySelector('[data-field="position"]')?.value || '',
      is_sub:        row.querySelector('[data-field="is_sub"]')?.checked ? 1 : 0,
    }));
  };

  const homeRows = readRows('editHomeTable');
  const awayRows = readRows('editAwayTable');

  el('saveLineupBtn').disabled = true;
  el('saveLineupBtn').textContent = '⏳ Saving…';

  try {
    for (const p of homeRows) {
      if (!p.name) continue;
      if (p.player_id) {
        await fetch(`/api/players/${p.player_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: p.name, jersey_number: p.jersey_number, position: p.position })
        });
      }
      if (p.lineup_id) {
        await fetch(`/api/lineup/${p.lineup_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jersey_number: p.jersey_number, position: p.position, is_sub: p.is_sub })
        });
      }
    }
    for (const p of awayRows) {
      if (!p.name) continue;
      if (p.player_id) {
        await fetch(`/api/players/${p.player_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: p.name, jersey_number: p.jersey_number, position: p.position })
        });
      }
      if (p.lineup_id) {
        await fetch(`/api/lineup/${p.lineup_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jersey_number: p.jersey_number, position: p.position, is_sub: p.is_sub })
        });
      }
    }
    toast('Lineup saved ✓', 'success');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  } finally {
    el('saveLineupBtn').disabled = false;
    el('saveLineupBtn').textContent = '💾 Save Lineup Changes';
  }
}

/* ════════════════════════════════════════
   LOAD TEAMS
════════════════════════════════════════ */
async function loadTeams() {
  try {
    allTeams = await fetch('/api/teams').then(r => r.json());
  } catch (e) { console.warn('Could not load teams'); }
}

/* ════════════════════════════════════════
   SOCKET.IO REAL-TIME
════════════════════════════════════════ */
socket.on('state', state => {
  // Check if active match ID changed
  const matchChanged = !lastState || !lastState.match || !state.match || (lastState.match.id !== state.match.id);
  
  // Check if events count changed
  const eventsChanged = !lastState || !lastState.events || !state.events || (lastState.events.length !== state.events.length);
  
  // Check if lineups changed
  const lineupsChanged = matchChanged || !lastState || 
    (JSON.stringify(lastState.homeLineup) !== JSON.stringify(state.homeLineup)) ||
    (JSON.stringify(lastState.awayLineup) !== JSON.stringify(state.awayLineup));

  // Check if matches list info changed (status, score, teams, or venue)
  const matchesChanged = !lastState || !lastState.matches || !state.matches || 
    (JSON.stringify(lastState.matches.map(m => ({id: m.id, status: m.status, hs: m.home_score, as: m.away_score}))) !== 
     JSON.stringify(state.matches.map(m => ({id: m.id, status: m.status, hs: m.home_score, as: m.away_score}))));

  lastState = state;
  liveState = state;

  if (state.match) {
    activeMatchId = state.match.id;
  }

  // 1. Render live panel stats and clock
  renderLivePanel(state);

  // 2. Render events log ONLY if events changed or match changed
  if (eventsChanged || matchChanged) {
    renderEventsLog(state);
  }

  // 3. Populate MVP Options and select value ONLY if lineups or match changed,
  // and only set value if the user is not currently focusing/interacting with it.
  if (lineupsChanged || matchChanged) {
    renderMvpDropdown(state);
  } else if (state.match && document.activeElement !== el('mvpSelect')) {
    el('mvpSelect').value = state.match.mvp_player_id || '';
  }

  // 4. Render edit lineup ONLY if lineups or match changed,
  // and only if the user is not actively editing inside the lineup table (e.g. input is not focused).
  const isEditingLineup = el('editLineupContent')?.contains(document.activeElement);
  if ((lineupsChanged || matchChanged) && !isEditingLineup) {
    renderEditLineup(state);
  }

  // 5. Update match list and selector only if matches list changed
  if (matchesChanged || matchChanged) {
    allMatches = state.matches || [];
    renderMatchSelector();
    renderMatchList();
  }
});

/* live clock tick for live matches in admin panel — smooth local interpolation */
setInterval(() => {
  if (!liveState || !liveState.match) return;
  const m = liveState.match;
  // Only tick if timer is running and match status is live/active
  if (!m.timer_running) return;
  const statusLower = (m.status || '').toLowerCase();
  if (!['live', 'in_progress', '1h', '2h'].includes(statusLower)) return;
  // Increment local cached value so next renderLivePanel call uses fresh seconds
  m.match_time_seconds = (m.match_time_seconds || 0) + 1;
  // Update DOM directly without full re-render
  const clockEl = el('liveMatchClock');
  if (clockEl) clockEl.textContent = formatClock(m.match_time_seconds);
  // Also update the ring arc
  updateTimerRing(m.match_time_seconds);
}, 1000);

/* ════════════════════════════════════════
   INIT
════════════════════════════════════════ */
(async function init() {
  // Setup Create Match collapse toggle
  const toggle = el('createMatchToggle');
  const body = el('createMatchBody');
  if (toggle && body) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      body.classList.toggle('open');
    });
  }

  // Bind Advanced Event Modal buttons
  el('closeEventModalBtn').addEventListener('click', closeEventModal);
  el('cancelEventModalBtn').addEventListener('click', closeEventModal);
  el('saveEventModalBtn').addEventListener('click', saveEventModal);

  // Bind Match Phase (status) update button
  el('updateStatusBtn').addEventListener('click', async () => {
    if (!activeMatchId) return toast('Select a match first', 'error');
    const newStatus = el('statusSelect').value;
    try {
      await fetch(`/api/matches/${activeMatchId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      toast(`Match status updated to ${STATUS_LABELS[newStatus] || newStatus}`, 'success');
    } catch (e) { toast('Failed to update status', 'error'); }
  });

  await loadTeams();
  await loadMatches();
  // Load current state
  const state = await fetch('/api/state').then(r => r.json()).catch(() => ({}));
  if (state.match) {
    activeMatchId = state.match.id;
    el('globalMatchSelect').value = activeMatchId;
    lastState = state;
    liveState = state;
    renderLivePanel(state);
    renderEventsLog(state);
    renderMvpDropdown(state);
    renderEditLineup(state);
    renderMatchList();
  }
})();
