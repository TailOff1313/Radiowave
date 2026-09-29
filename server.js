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

// Список доступных каналов
const CHANNELS = {
  general: 'Общий',
  alpha:   'Альфа',
  bravo:   'Браво',
  charlie: 'Чарли'
};

wss.on('connection', (ws) => {
  ws.channel = null;
  ws.name = 'Гость';

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Аудио — рассылаем только участникам того же канала
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
    }
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {

    case 'join': {
      const ch = CHANNELS[msg.channel] ? msg.channel : 'general';
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
      break;
    }

    case 'chat': {
      if (!ws.channel) return;
      const text = String(msg.text || '').slice(0, 500).trim();
      if (!text) return;
      // Себе тоже отправляем — чтобы видеть своё сообщение в чате
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Рация запущена на порту', PORT));
