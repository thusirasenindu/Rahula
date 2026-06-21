# Rahula College Football Live Scoreboard

A modern live scoreboard web app with admin controls, real-time updates, and SQLite persistence.

## Features
- Live scoreboard page with team names, logos, scores, timer, and match status
- Admin panel for creating and managing matches
- Score, yellow/red cards, corners, timer controls
- Player roster and match player stats management
- Upcoming fixtures section
- SQLite database persistence
- Real-time sync with Socket.IO

## Run locally
1. Open a terminal in this folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open the app:
   - Scoreboard: `http://localhost:4000/scoreboard`
   - Admin panel: `http://localhost:4000/admin`

## Notes
- The app stores data in `data/scoreboard.db`.
- The admin panel immediately pushes updates to the scoreboard via WebSockets.
- You can create teams, players, matches, and update live match state from the admin UI.
