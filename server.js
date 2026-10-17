'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const MAX_PLAYERS = 12;
const MAX_PAYLOAD = 16 * 1024;
const ROOT = __dirname;
const rooms = new Map();
const clients = new Set();
let publicRoomSerial = 1;
const PRIVATE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function safeName(value) {
  return String(value || 'Lüdi-Spieler').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'Lüdi-Spieler';
}
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function roomFor(ws) { return ws.ludiRoom ? rooms.get(ws.ludiRoom) : null; }
function playerFor(ws) { const room = roomFor(ws); return room && room.players.get(ws.ludiId); }
function privateCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => PRIVATE_ALPHABET[crypto.randomInt(PRIVATE_ALPHABET.length)]).join('');
  } while (rooms.has('private:' + code));
  return code;
}
function makeRoom(mode) {
  if (mode === 'public') {
    const roomCode = 'PUB-' + String(publicRoomSerial++).padStart(3, '0');
    const room = { id: 'public:' + roomCode, mode: 'public', roomCode, players: new Map(), hostId: null, roundFinished: false, hasStarted: false };
    rooms.set(room.id, room); return room;
  }
  const roomCode = privateCode();
  const room = { id: 'private:' + roomCode, mode: 'private', roomCode, players: new Map(), hostId: null, roundFinished: false, hasStarted: false };
  rooms.set(room.id, room); return room;
}
function availablePublicRoom() {
  for (const room of rooms.values()) if (room.mode === 'public' && room.players.size < MAX_PLAYERS && !room.roundFinished) return room;
  return makeRoom('public');
}
function roomState(room) {
  return {
    type: 'roomState', mode: room.mode, roomCode: room.roomCode, maxPlayers: MAX_PLAYERS,
    roundFinished: room.roundFinished,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, ready: !!p.ready, playing: !!p.playing,
      alive: !!p.alive, x: p.x, z: p.z, groundY: p.groundY, jumpY: p.jumpY,
      face: p.face, hp: p.hp, inBase: !!p.inBase, vehicle: !!p.vehicle
    }))
  };
}
function broadcastRoom(room, data, exceptId = null) {
  const raw = JSON.stringify(data);
  for (const p of room.players.values()) if (p.id !== exceptId && p.ws.readyState === WebSocket.OPEN) p.ws.send(raw);
}
function sendRoomState(room) { broadcastRoom(room, roomState(room)); }
function evaluateWinner(room) {
  if (!room || room.roundFinished) return;
  const playing = Array.from(room.players.values()).filter(p => p.playing);
  if (playing.length < 2) return;
  const dead = playing.some(p => !p.alive);
  const living = playing.filter(p => p.alive);
  if (dead && living.length === 1) {
    room.roundFinished = true;
    broadcastRoom(room, { type: 'winner', winnerId: living[0].id, winnerName: living[0].name });
  }
}
function markDead(room, player) {
  if (!room || !player || player.eliminatedReported) return;
  player.alive = false;
  player.hp = 0;
  player.eliminatedReported = true;
  sendRoomState(room);
  if (player.lastDamagedBy && player.lastDamagedBy !== player.id) {
    const killer = room.players.get(player.lastDamagedBy);
    if (killer) send(killer.ws, { type: 'playerEliminated', id: player.id, by: killer.id, name: player.name });
  }
  evaluateWinner(room);
}
function detach(ws) {
  const room = roomFor(ws);
  const player = playerFor(ws);
  if (!room || !player) { ws.ludiRoom = null; ws.ludiId = null; return; }
  room.players.delete(player.id);
  ws.ludiRoom = null; ws.ludiId = null;
  broadcastRoom(room, { type: 'peerLeft', id: player.id, name: player.name, players: Array.from(room.players.values()).map(p => ({ id:p.id, name:p.name, ready:p.ready, playing:p.playing, alive:p.alive, x:p.x, z:p.z, face:p.face, hp:p.hp, inBase:p.inBase })) });
  if (room.players.size === 0) rooms.delete(room.id); else {
    if (room.hostId === player.id) room.hostId = room.players.keys().next().value;
    sendRoomState(room); evaluateWinner(room);
  }
}
function joinRoom(ws, packet) {
  detach(ws);
  const mode = String(packet.mode || 'public');
  let room;
  if (mode === 'public') room = availablePublicRoom();
  else if (mode === 'createPrivate') room = makeRoom('private');
  else if (mode === 'joinPrivate') {
    const code = String(packet.roomCode || '').trim().toUpperCase();
    room = rooms.get('private:' + code);
    if (!room) return send(ws, { type: 'error', message: 'Dieser private Lobby-Code wurde nicht gefunden.' });
    if (room.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Diese Lobby ist voll.' });
    if (room.roundFinished) return send(ws, { type: 'error', message: 'Diese Runde ist bereits beendet. Erstelle eine neue Lobby.' });
  } else return send(ws, { type: 'error', message: 'Unbekannter Lobby-Modus.' });
  if (room.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Diese Lobby ist voll.' });
  const id = crypto.randomUUID();
  const player = {
    id, ws, name: safeName(packet.name), ready: false, playing: false, alive: true,
    x: 0, z: 0, groundY: 0, jumpY: 0, face: 0, hp: 100,
    inBase: false, vehicle: false, weapon: 0, lastDamagedBy: null, eliminatedReported: false,
    lastStateAt: 0, hitWindowAt: 0, hitsInWindow: 0
  };
  room.players.set(id, player);
  if (!room.hostId) room.hostId = id;
  ws.ludiRoom = room.id; ws.ludiId = id;
  send(ws, { type: 'joined', id, roomCode: room.roomCode, mode: room.mode, isHost: room.hostId === id, maxPlayers: MAX_PLAYERS, players: Array.from(room.players.values()).map(p => ({ id:p.id, name:p.name, ready:p.ready, playing:p.playing, alive:p.alive, x:p.x, z:p.z, face:p.face, hp:p.hp, inBase:p.inBase })) });
  for (const other of room.players.values()) if (other.id !== id && other.playing) send(ws, { type: 'peerState', player: { id:other.id, name:other.name, x:other.x, z:other.z, groundY:other.groundY, jumpY:other.jumpY, face:other.face, hp:other.hp, alive:other.alive, playing:other.playing, inBase:other.inBase, vehicle:other.vehicle, weapon:other.weapon } });
  sendRoomState(room);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, name: 'Lüdi Island Clash Online Alpha', rooms: rooms.size, connections: clients.size }));
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found');
  }
  const htmlPath = path.join(ROOT, 'index.html');
  fs.readFile(htmlPath, (err, data) => {
    if (err) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Game file missing: ' + err.message); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(data);
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname !== '/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  clients.add(ws); ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'notice', message: 'Online-Server verbunden. Wähle eine öffentliche oder private Lobby.' });
  ws.on('message', raw => {
    if (raw.length > MAX_PAYLOAD) return ws.close(1009, 'Message too large');
    let packet; try { packet = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Ungültiges Nachrichtenformat.' }); }
    if (!packet || typeof packet.type !== 'string') return;
    const room = roomFor(ws), player = playerFor(ws);
    if (packet.type === 'join') return joinRoom(ws, packet);
    if (packet.type === 'leave') { detach(ws); return; }
    if (!room || !player) return send(ws, { type: 'error', message: 'Tritt zuerst einer Lobby bei.' });
    if (packet.type === 'ready') { player.ready = !!packet.ready; sendRoomState(room); return; }
    if (packet.type === 'roundStart') {
      if (room.roundFinished) { for (const p of room.players.values()) { p.playing = false; p.alive = true; p.hp = 100; p.lastDamagedBy = null; p.eliminatedReported = false; } room.roundFinished = false; room.hasStarted = false; }
      player.playing = true; player.alive = true; player.hp = 100; player.ready = true; room.hasStarted = true;
      broadcastRoom(room, { type: 'roundStart', playerId: player.id, name: player.name }); sendRoomState(room); return;
    }
    if (packet.type === 'roundEnd') { if (packet.win === true && player.playing && player.alive && !room.roundFinished) { room.roundFinished = true; broadcastRoom(room, { type: 'winner', winnerId: player.id, winnerName: player.name }); sendRoomState(room); return; } markDead(room, player); return; }
    if (packet.type === 'state') {
      const now = Date.now(); if (now - player.lastStateAt < 35) return; player.lastStateAt = now;
      const wasAlive = player.alive;
      player.x = Math.max(-2400, Math.min(2400, finite(packet.x)));
      player.z = Math.max(-2400, Math.min(2400, finite(packet.z)));
      player.groundY = Math.max(-100, Math.min(400, finite(packet.groundY)));
      player.jumpY = Math.max(-10, Math.min(80, finite(packet.jumpY)));
      player.face = finite(packet.face);
      player.hp = Math.max(0, Math.min(100, finite(packet.hp, 100)));
      player.alive = !!packet.alive && player.hp > 0 && player.playing;
      player.inBase = !!packet.inBase; player.vehicle = !!packet.vehicle;
      player.weapon = Math.max(0, Math.min(4, Math.floor(finite(packet.weapon))));
      player.name = safeName(packet.name || player.name);
      broadcastRoom(room, { type: 'peerState', player: { id:player.id, name:player.name, x:player.x, z:player.z, groundY:player.groundY, jumpY:player.jumpY, face:player.face, hp:player.hp, alive:player.alive, inBase:player.inBase, vehicle:player.vehicle, weapon:player.weapon, playing:player.playing } }, player.id);
      if (wasAlive && !player.alive) markDead(room, player); else if (wasAlive !== player.alive) sendRoomState(room);
      return;
    }
    if (packet.type === 'hit') {
      const target = room.players.get(String(packet.targetId || ''));
      if (!target || target.id === player.id || !target.playing || !target.alive || !player.playing || !player.alive || room.roundFinished) return;
      const now = Date.now();
      if (now - player.hitWindowAt > 1000) { player.hitWindowAt = now; player.hitsInWindow = 0; }
      player.hitsInWindow++;
      if (player.hitsInWindow > 18) return;
      const damage = Math.max(1, Math.min(1000000, Math.floor(finite(packet.damage, 1))));
      target.lastDamagedBy = player.id;
      send(target.ws, { type: 'damage', targetId: target.id, attackerId: player.id, damage, headshot: !!packet.headshot, weaponIndex: Math.max(0, Math.min(4, Math.floor(finite(packet.weaponIndex)))) });
      send(ws, { type: 'hitConfirm', targetId: target.id, damage, headshot: !!packet.headshot });
      return;
    }
    if (packet.type === 'chat') {
      const text = String(packet.text || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 120);
      if (text) broadcastRoom(room, { type:'chat', id:player.id, name:player.name, text });
      return;
    }
  });
  ws.on('close', () => { clients.delete(ws); detach(ws); });
  ws.on('error', () => { clients.delete(ws); detach(ws); });
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch { ws.terminate(); } }
}, 30000);
server.on('close', () => clearInterval(heartbeat));
server.listen(PORT, HOST, () => console.log(`Lüdi Island Clash Online Alpha läuft auf http://${HOST}:${PORT} (WebSocket /ws)`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
