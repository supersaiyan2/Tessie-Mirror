const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading page');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// rooms: Map<roomCode, { phone?: WebSocket, browser?: WebSocket }>
const rooms = new Map();

wss.on('connection', (ws) => {
  let roomCode = null;
  let role = null;

  ws.on('message', (rawData, isBinary) => {
    // Binary = JPEG frame from phone, relay directly to browser
    if (isBinary) {
      if (role === 'phone' && roomCode) {
        const room = rooms.get(roomCode);
        if (room?.browser?.readyState === WebSocket.OPEN) {
          room.browser.send(rawData, { binary: true });
        }
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        roomCode = (msg.room || '').toUpperCase().trim();
        role = msg.role; // 'phone' or 'browser'
        if (!roomCode || !role) return;

        if (!rooms.has(roomCode)) rooms.set(roomCode, {});
        const room = rooms.get(roomCode);
        room[role] = ws;

        ws.send(JSON.stringify({ type: 'joined', room: roomCode, role }));

        const other = role === 'phone' ? room.browser : room.phone;
        if (other?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'peer_ready' }));
          other.send(JSON.stringify({ type: 'peer_ready' }));
        }
        break;
      }

      case 'touch':
      case 'swipe': {
        if (role === 'browser' && roomCode) {
          const room = rooms.get(roomCode);
          if (room?.phone?.readyState === WebSocket.OPEN) {
            room.phone.send(JSON.stringify(msg));
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room[role] === ws) {
      delete room[role];
      const other = role === 'phone' ? room.browser : room.phone;
      if (other?.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify({ type: 'peer_disconnected' }));
      }
    }

    if (!room.phone && !room.browser) {
      rooms.delete(roomCode);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TeslaMirror relay server listening on port ${PORT}`);
});
