const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==================== 数据管理 ====================

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { tables: [], sessions: [], archives: [] };
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

// 首次启动：初始化 8 张桌
if (data.tables.length === 0) {
  for (let i = 1; i <= 8; i++) {
    data.tables.push({
      id: `t${i}`,
      name: `${i}号桌`,
      seats: 4,
      status: 'idle',
      sessionStart: null
    });
  }
  saveData();
}

// ==================== 工具函数 ====================

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function broadcast(message) {
  const msg = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function endSession(table) {
  if (!table.sessionStart) return;
  const session = {
    id: `s${Date.now()}_${table.id}`,
    tableId: table.id,
    tableName: table.name,
    startTime: table.sessionStart,
    endTime: new Date().toISOString(),
    duration: Date.now() - new Date(table.sessionStart).getTime()
  };
  data.sessions.push(session);
}

function computeStats(date) {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const daySessions = data.sessions.filter(s => s.startTime.startsWith(targetDate));

  const tableStats = {};
  data.tables.forEach(t => {
    tableStats[t.id] = { id: t.id, name: t.name, count: 0, totalDuration: 0 };
  });

  daySessions.forEach(s => {
    if (tableStats[s.tableId]) {
      tableStats[s.tableId].count++;
      tableStats[s.tableId].totalDuration += s.duration;
    }
  });

  const totalSessions = daySessions.length;
  const totalDuration = daySessions.reduce((sum, s) => sum + s.duration, 0);
  const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

  // 按小时统计客流
  const hourlyFlow = new Array(24).fill(0);
  daySessions.forEach(s => {
    const hour = new Date(s.startTime).getHours();
    hourlyFlow[hour]++;
  });

  return {
    date: targetDate,
    totalSessions,
    avgDuration,
    totalDuration,
    currentInUse: data.tables.filter(t => t.status === 'in_use').length,
    currentIdle: data.tables.filter(t => t.status === 'idle').length,
    currentCleaning: data.tables.filter(t => t.status === 'cleaning').length,
    totalTables: data.tables.length,
    occupancyRate: data.tables.length > 0
      ? Math.round(data.tables.filter(t => t.status === 'in_use').length / data.tables.length * 100)
      : 0,
    tableStats: Object.values(tableStats).sort((a, b) => b.count - a.count),
    hourlyFlow
  };
}

// ==================== REST API ====================

app.get('/api/info', (req, res) => {
  res.json({ ip: getLocalIP(), port: PORT });
});

// ==================== WebSocket ====================

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    tables: data.tables,
    stats: computeStats()
  }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'update_status': {
        const table = data.tables.find(t => t.id === msg.tableId);
        if (!table) return;

        const newStatus = msg.status;

        // 离开 in_use 时结束会话
        if (table.status === 'in_use' && newStatus !== 'in_use') {
          endSession(table);
        }

        // 进入 in_use 时开始计时
        if (newStatus === 'in_use') {
          table.sessionStart = new Date().toISOString();
          if (msg.durationMin) {
            table.duration = msg.durationMin * 60 * 1000;
            table.endTime = new Date(Date.now() + table.duration).toISOString();
          } else {
            table.duration = null;
            table.endTime = null;
          }
        } else {
          table.sessionStart = null;
          table.duration = null;
          table.endTime = null;
        }

        table.status = newStatus;
        saveData();

        broadcast({ type: 'tables_updated', tables: data.tables });
        broadcast({ type: 'stats_updated', stats: computeStats() });
        break;
      }

      case 'extend_time': {
        const table = data.tables.find(t => t.id === msg.tableId);
        if (!table || table.status !== 'in_use') return;

        const extendMs = msg.minutes * 60 * 1000;
        const currentEnd = table.endTime ? new Date(table.endTime).getTime() : Date.now();
        const newEnd = Math.max(currentEnd, Date.now()) + extendMs;
        table.endTime = new Date(newEnd).toISOString();
        if (table.duration) {
          table.duration += extendMs;
        } else {
          table.duration = newEnd - new Date(table.sessionStart).getTime();
        }
        saveData();
        broadcast({ type: 'tables_updated', tables: data.tables });
        break;
      }

      case 'add_table': {
        const newTable = {
          id: `t${Date.now()}`,
          name: msg.name || `${data.tables.length + 1}号桌`,
          seats: msg.seats || 4,
          status: 'idle',
          sessionStart: null
        };
        data.tables.push(newTable);
        saveData();
        broadcast({ type: 'tables_updated', tables: data.tables });
        broadcast({ type: 'stats_updated', stats: computeStats() });
        break;
      }

      case 'remove_table': {
        const table = data.tables.find(t => t.id === msg.tableId);
        if (table && table.status === 'in_use') {
          endSession(table);
        }
        data.tables = data.tables.filter(t => t.id !== msg.tableId);
        saveData();
        broadcast({ type: 'tables_updated', tables: data.tables });
        broadcast({ type: 'stats_updated', stats: computeStats() });
        break;
      }

      case 'update_table': {
        const table = data.tables.find(t => t.id === msg.tableId);
        if (table) {
          if (msg.name) table.name = msg.name;
          if (msg.seats) table.seats = msg.seats;
          saveData();
          broadcast({ type: 'tables_updated', tables: data.tables });
        }
        break;
      }

      case 'close_day': {
        // 结束所有使用中的桌位
        data.tables.forEach(t => {
          if (t.status === 'in_use') {
            endSession(t);
          }
          t.status = 'idle';
          t.sessionStart = null;
          t.duration = null;
          t.endTime = null;
        });

        // 归档
        const today = new Date().toISOString().split('T')[0];
        const todaySessions = data.sessions.filter(s => s.startTime.startsWith(today));
        data.archives = data.archives || [];
        data.archives.push({
          date: today,
          sessionCount: todaySessions.length,
          totalDuration: todaySessions.reduce((sum, s) => sum + s.duration, 0)
        });

        saveData();
        broadcast({ type: 'tables_updated', tables: data.tables });
        broadcast({ type: 'stats_updated', stats: computeStats() });
        broadcast({ type: 'day_closed', date: today, summary: computeStats(today) });
        break;
      }

      case 'get_stats': {
        ws.send(JSON.stringify({
          type: 'stats_data',
          stats: computeStats(msg.date)
        }));
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  ================================');
  console.log('   拼豆店工位管理系统已启动');
  console.log('  ================================');
  console.log(`  大屏看板:  http://localhost:${PORT}`);
  console.log(`  手机访问:  http://${ip}:${PORT}`);
  console.log('  -------------------------------');
  console.log('  员工手机浏览器打开上方链接即可');
  console.log('  ================================');
  console.log('');
});
