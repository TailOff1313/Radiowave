const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Server error'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// Каналы: имя + пароль (null = без пароля)
const CHANNELS = {
  general: { name: 'Общий', password: null },
  alpha:   { name: 'Альфа', password: '1111' },
  bravo:   { name: 'Браво', password: '2222' },
  charlie: { name: 'Чарли', password: '0216' }
};

function getChannelCounts() {
  const counts = {};
  for (const key in CHANNELS) counts[key] = 0;
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN && c.channel && counts[c.channel] !== undefined) {
      counts[c.channel]++;
    }
  }
  return counts;
}

function broadcastChannelCounts() {
  const payload = JSON.stringify({ type: 'channel-counts', counts: getChannelCounts() });
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

function broadcastToChannel(channel, obj, exclude) {
  const payload = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c !== exclude && c.readyState === WebSocket.OPEN && c.channel === channel) {
      c.send(payload);
    }
  }
}

function sendUserList(channel) {
  const names = [];
  for (const c of wss.clients) {
    if (c.channel === channel && c.readyState === WebSocket.OPEN) names.push(c.name);
  }
  const payload = JSON.stringify({ type: 'users', list: names });
  for (const c of wss.clients) {
    if (c.channel === channel && c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

wss.on('connection', (ws) => {
  ws.channel = null;
  ws.name = 'Гость';

  // Сразу отправляем текущие счётчики по каналам
  ws.send(JSON.stringify({ type: 'channel-counts', counts: getChannelCounts() }));

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      for (const c of wss.clients) {
        if (c !== ws && c.readyState === WebSocket.OPEN && c.channel === ws.channel) {
          c.send(data);
        }
      }
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    if (ws.channel) {
      const ch = ws.channel;
      broadcastToChannel(ch, { type: 'system', text: `${ws.name} покинул канал` }, ws);
      broadcastToChannel(ch, { type: 'talk', name: ws.name, on: false }, ws);
      sendUserList(ch);
      broadcastChannelCounts();
    }
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {

    case 'join': {
      const ch = msg.channel;
      const info = CHANNELS[ch];
      if (!info) {
        ws.send(JSON.stringify({ type: 'join-denied', channel: ch, reason: 'not-found' }));
        return;
      }
      if (info.password && String(msg.password || '') !== info.password) {
        ws.send(JSON.stringify({ type: 'join-denied', channel: ch, reason: 'wrong-password' }));
        return;
      }

      const oldChannel = ws.channel;
      ws.channel = ch;
      ws.name = String(msg.name || 'Гость').slice(0, 24).trim() || 'Гость';

      if (oldChannel && oldChannel !== ch) {
        broadcastToChannel(oldChannel, { type: 'system', text: `${ws.name} вышел` }, ws);
        broadcastToChannel(oldChannel, { type: 'talk', name: ws.name, on: false }, ws);
        sendUserList(oldChannel);
      }

      broadcastToChannel(ch, { type: 'system', text: `${ws.name} в эфире` }, ws);
      sendUserList(ch);
      ws.send(JSON.stringify({ type: 'joined', channel: ch }));
      broadcastChannelCounts();
      break;
    }

    case 'chat': {
      if (!ws.channel) return;
      const text = String(msg.text || '').slice(0, 500).trim();
      if (!text) return;
      broadcastToChannel(ws.channel, {
        type: 'chat',
        from: ws.name,
        text,
        time: Date.now()
      });
      break;
    }

    case 'talk': {
      if (!ws.channel) return;
      broadcastToChannel(ws.channel, {
        type: 'talk',
        name: ws.name,
        on: !!msg.on
      }, ws);
      break;
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Рация запущена на порту', PORT));
