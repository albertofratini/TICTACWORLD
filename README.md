# TicTacWorld 🌍

Geography tic-tac-toe. Each row and column carries a clue (*"Has more than 60M people"*, *"Has a Wonder of the World"*, *"Name starts with G"*, *"Drives on the left"*…). Tap a square and name a country that satisfies **both** clues. Rarer answers score more.

## Modes
- **Solo / Daily** – fill the 3×3 grid with 3 strikes allowed. Daily puzzle is the same for everyone; share your emoji grid.
- **Friend groups (async)** – create a group, share the link/code, create challenges. Everyone plays the same grid whenever they like; server validates every guess; group leaderboard and per-challenge picks (revealed once you finish).
- **Live 1 vs 1** – quick match or invite link. Alternate turns, server-side turn timer (20–60 s), wrong answer = lost turn, three in a row wins (full board → higher points wins), rematch with swapped starter, spectators via link.

## Rarity scoring
Points depend on how many valid answers a square has: 1 → **+10 legendary**, 2 → +8 epic, 3–4 → +6 rare, 5–8 → +4 uncommon, 9–19 → +3, 20–39 → +2, 40+ → +1. Solo/group also gives +5 per completed line and +10 for a full grid.

## Formats (themes)
Implemented: **Countries**, **Capitals** (name the capital; clues about the capital's name too), **Flags** (flag colours/symbols crossed with geography).
Ideas for more: world cities, rivers & mountains, landmarks/UNESCO sites, languages, national dishes, football clubs/leagues, airports, currencies. A format is just a data set + a pool of clues in `public/js/data.js` / `engine.js`.

## Run
```
npm start        # http://localhost:3000  (PORT, DATA_DIR env vars supported)
npm test
```
Zero dependencies (Node ≥ 18). Live play uses Server-Sent Events + POST; groups persist to `data/groups.json`; rooms live in memory. Shared engine (`public/js/engine.js`) generates grids deterministically from a seed on both client and server and guarantees every square has an answer and the grid can be filled with nine distinct countries.

Data is hand-curated (193 countries); if you spot a wrong fact, fix the list in `public/js/data.js`.
