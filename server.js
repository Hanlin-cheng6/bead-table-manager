const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const USERS_FILE = path.join(__dirname, 'users.json');
const PORT = process.env.PORT || 3000;
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7天有效期（滑动续期）

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==================== 用户数据 ====================

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { users: {}, tokens: {} };
  }
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function getStoreDataFile(storeId) {
  return path.join(__dirname, `data_${storeId}.json`);
}

function loadStoreData(storeId) {
  try {
    return JSON.parse(fs.readFileSync(getStoreDataFile(storeId), 'utf8'));
  } catch {
    return { tables: [], sessions: [], archives: [] };
  }
}

function saveStoreData(storeId, data) {
  fs.writeFileSync(getStoreDataFile(storeId), JSON.stringify(data, null, 2));
}

function generateStoreId() {
  return crypto.randomBytes(3).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const computed = hashPassword(password, salt);
  // 防止时序攻击
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

function initStoreTables(data) {
  if (data.tables.length === 0) {
    for (let i = 1; i <= 8; i++) {
      data.tables.push({
        id: `t${i}`,
        name: `${i}\u53f7\u684c`,
        seats: 4,
        status: 'idle',
        sessionStart: null
      });
    }
  }
  return data;
}

// 内存缓存
const storeDataCache = {};

function getStoreData(storeId) {
  if (!storeDataCache[storeId]) {
    let data = loadStoreData(storeId);
    data = initStoreTables(data);
    storeDataCache[storeId] = data;
    saveStoreData(storeId, data);
  }
  return storeDataCache[storeId];
}

function verifyAndRefreshToken(token) {
  if (!token) return null;
  const users = loadUsers();
  const tokenInfo = users.tokens[token];
  if (!tokenInfo) return null;

  // 检查是否过期
  if (tokenInfo.expires && Date.now() > tokenInfo.expires) {
    delete users.tokens[token];
    saveUsers(users);
    return null;
  }

  // 滑动续期：每次验证通过，自动延长 7 天
  tokenInfo.expires = Date.now() + TOKEN_TTL;
  saveUsers(users);

  return tokenInfo;
}

// 登录失败次数限制：按用户名统计，15分钟内最多5次失败，超限锁定30分钟
const loginAttempts = new Map(); // key: username -> { count, firstTime, lockUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 30 * 60 * 1000;

function getLoginAttemptStatus(username) {
  const now = Date.now();
  let record = loginAttempts.get(username);
  if (!record) {
    return { count: 0, remaining: MAX_LOGIN_ATTEMPTS, locked: false, lockSeconds: 0 };
  }

  if (record.lockUntil > now) {
    return {
      count: record.count,
      remaining: 0,
      locked: true,
      lockSeconds: Math.ceil((record.lockUntil - now) / 1000)
    };
  }

  if (now - record.firstTime > LOGIN_WINDOW_MS) {
    loginAttempts.delete(username);
    return { count: 0, remaining: MAX_LOGIN_ATTEMPTS, locked: false, lockSeconds: 0 };
  }

  return {
    count: record.count,
    remaining: Math.max(0, MAX_LOGIN_ATTEMPTS - record.count),
    locked: false,
    lockSeconds: 0
  };
}

function recordLoginFailure(username) {
  const now = Date.now();
  let record = loginAttempts.get(username);
  if (!record) {
    record = { count: 0, firstTime: now, lockUntil: 0 };
    loginAttempts.set(username, record);
  }

  if (now - record.firstTime > LOGIN_WINDOW_MS) {
    record.count = 0;
    record.firstTime = now;
    record.lockUntil = 0;
  }

  record.count++;

  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockUntil = now + LOGIN_LOCK_MS;
  }
}

function recordLoginSuccess(username) {
  loginAttempts.delete(username);
}

// ==================== 频率限制 ====================

const rateLimitMap = new Map(); // key: ip+route -> { count, firstTime, lockUntil }

function rateLimit(options) {
  const { windowMs, max, lockMs } = options;
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    const key = `${ip}:${req.path}`;
    const now = Date.now();

    let record = rateLimitMap.get(key);
    if (!record) {
      record = { count: 0, firstTime: now, lockUntil: 0 };
      rateLimitMap.set(key, record);
    }

    // 锁定中，直接拒绝
    if (record.lockUntil > now) {
      const waitSec = Math.ceil((record.lockUntil - now) / 1000);
      res.set('Retry-After', String(waitSec));
      return res.status(429).json({ error: `操作过于频繁，请 ${waitSec} 秒后再试` });
    }

    // 窗口过期，重置计数
    if (now - record.firstTime > windowMs) {
      record.count = 0;
      record.firstTime = now;
    }

    record.count++;

    // 超过阈值，锁定
    if (record.count > max) {
      record.lockUntil = now + lockMs;
      const waitSec = Math.ceil(lockMs / 1000);
      res.set('Retry-After', String(waitSec));
      return res.status(429).json({ error: `失败次数过多，请 ${waitSec} 秒后再试` });
    }

    next();
  };
}

// 注册：1小时内最多3次，超限后锁定1小时
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, lockMs: 60 * 60 * 1000 });

// ==================== 认证 API ====================

app.post('/api/register', registerLimiter, (req, res) => {
  const { username, password, storeName } = req.body;

  if (!username || !password || !storeName) {
    return res.status(400).json({ error: '\u8bf7\u586b\u5199\u6240\u6709\u5b57\u6bb5' });
  }

  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: '\u7528\u6237\u540d\u9700\u8981 2-20 \u4e2a\u5b57\u7b26' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '\u5bc6\u7801\u81f3\u5c11 6 \u4f4d' });
  }

  const users = loadUsers();
  if (users.users[username]) {
    return res.status(409).json({ error: '\u7528\u6237\u540d\u5df2\u5b58\u5728' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const storeId = generateStoreId();
  const token = generateToken();

  users.users[username] = {
    passwordHash,
    passwordSalt: salt,
    storeId,
    storeName,
    createdAt: new Date().toISOString()
  };
  users.tokens[token] = {
    username,
    storeId,
    storeName,
    createdAt: new Date().toISOString(),
    expires: Date.now() + TOKEN_TTL
  };
  saveUsers(users);

  // 初始化店铺数据
  const data = initStoreTables({ tables: [], sessions: [], archives: [] });
  storeDataCache[storeId] = data;
  saveStoreData(storeId, data);

  res.json({ token, storeName, storeId });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '\u8bf7\u8f93\u5165\u7528\u6237\u540d\u548c\u5bc6\u7801' });
  }

  // 检查是否因失败次数过多被锁定
  const status = getLoginAttemptStatus(username);
  if (status.locked) {
    return res.status(429).json({
      error: `\u767b\u5f55\u5931\u8d25\u6b21\u6570\u8fc7\u591a\uff0c\u8bf7 ${status.lockSeconds} \u79d2\u540e\u518d\u8bd5`,
      lockSeconds: status.lockSeconds,
      attempts: status.count,
      remaining: 0
    });
  }

  const users = loadUsers();
  const user = users.users[username];
  if (!user) {
    recordLoginFailure(username);
    const newStatus = getLoginAttemptStatus(username);
    return res.status(401).json({
      error: '\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef',
      attempts: newStatus.count,
      remaining: newStatus.remaining
    });
  }

  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    recordLoginFailure(username);
    const newStatus = getLoginAttemptStatus(username);
    const remainingText = newStatus.remaining > 0
      ? `\u8fd8\u5269 ${newStatus.remaining} \u6b21\u673a\u4f1a`
      : '\u5df2\u9501\u5b9a\u8d26\u6237\uff0c30\u5206\u949f\u540e\u518d\u8bd5';
    return res.status(401).json({
      error: `\u5bc6\u7801\u9519\u8bef\uff0c${remainingText}`,
      attempts: newStatus.count,
      remaining: newStatus.remaining,
      locked: newStatus.remaining === 0,
      lockSeconds: newStatus.lockSeconds
    });
  }

  recordLoginSuccess(username);

  const token = generateToken();
  users.tokens[token] = {
    username,
    storeId: user.storeId,
    storeName: user.storeName,
    createdAt: new Date().toISOString(),
    expires: Date.now() + TOKEN_TTL
  };
  saveUsers(users);

  res.json({ token, storeName: user.storeName, storeId: user.storeId });
});

app.get('/api/me', (req, res) => {
  const token = req.headers['x-token'];
  if (!token) return res.status(401).json({ error: '\u672a\u767b\u5f55' });

  const tokenInfo = verifyAndRefreshToken(token);
  if (!tokenInfo) return res.status(401).json({ error: 'token\u65e0\u6548' });

  res.json({
    username: tokenInfo.username,
    storeName: tokenInfo.storeName,
    storeId: tokenInfo.storeId
  });
});

// 找回密码：通过用户名 + 店铺名验证身份后重置密码
app.post('/api/reset-password', registerLimiter, (req, res) => {
  const { username, storeName, password } = req.body;

  if (!username || !storeName || !password) {
    return res.status(400).json({ error: '\u8bf7\u586b\u5199\u6240\u6709\u5b57\u6bb5' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '\u5bc6\u7801\u81f3\u5c11 6 \u4f4d' });
  }

  const users = loadUsers();
  const user = users.users[username];
  if (!user) {
    return res.status(404).json({ error: '\u7528\u6237\u4e0d\u5b58\u5728' });
  }

  if (user.storeName !== storeName.trim()) {
    return res.status(401).json({ error: '\u5e97\u94fa\u540d\u79f0\u4e0d\u5339\u914d' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = hashPassword(password, salt);
  user.passwordSalt = salt;

  // 重置登录失败次数，避免用户因锁定无法立即登录
  loginAttempts.delete(username);

  saveUsers(users);

  res.json({ success: true, message: '\u5bc6\u7801\u91cd\u7f6e\u6210\u529f\uff0c\u8bf7\u7528\u65b0\u5bc6\u7801\u767b\u5f55' });
});

// ==================== WebSocket ====================

function broadcastToStore(storeId, message) {
  const msg = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.storeId === storeId) {
      client.send(msg);
    }
  });
}

function endSession(data, table) {
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

function computeStats(data, date) {
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

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');

  if (!token) {
    ws.send(JSON.stringify({ type: 'error', message: '\u672a\u767b\u5f55' }));
    ws.close(1008, 'No token');
    return;
  }

  const tokenInfo = verifyAndRefreshToken(token);
  if (!tokenInfo) {
    ws.send(JSON.stringify({ type: 'error', message: '\u767b\u5f55\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55' }));
    ws.close(1008, 'Invalid token');
    return;
  }

  const storeId = tokenInfo.storeId;
  const storeName = tokenInfo.storeName;

  ws.storeId = storeId;
  const data = getStoreData(storeId);

  ws.send(JSON.stringify({
    type: 'init',
    storeName,
    tables: data.tables,
    stats: computeStats(data)
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

        if (table.status === 'in_use' && newStatus !== 'in_use') {
          endSession(data, table);
        }

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
        saveStoreData(storeId, data);

        broadcastToStore(storeId, { type: 'tables_updated', tables: data.tables });
        broadcastToStore(storeId, { type: 'stats_updated', stats: computeStats(data) });
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
        saveStoreData(storeId, data);
        broadcastToStore(storeId, { type: 'tables_updated', tables: data.tables });
        break;
      }

      case 'add_table': {
        const newTable = {
          id: `t${Date.now()}`,
          name: msg.name || `${data.tables.length + 1}\u53f7\u684c`,
          seats: msg.seats || 4,
          status: 'idle',
          sessionStart: null
        };
        data.tables.push(newTable);
        saveStoreData(storeId, data);
        broadcastToStore(storeId, { type: 'tables_updated', tables: data.tables });
        broadcastToStore(storeId, { type: 'stats_updated', stats: computeStats(data) });
        break;
      }

      case 'remove_table': {
        const table = data.tables.find(t => t.id === msg.tableId);
        if (table && table.status === 'in_use') {
          endSession(data, table);
        }
        data.tables = data.tables.filter(t => t.id !== msg.tableId);
        saveStoreData(storeId, data);
        broadcastToStore(storeId, { type: 'tables_updated', tables: data.tables });
        broadcastToStore(storeId, { type: 'stats_updated', stats: computeStats(data) });
        break;
      }

      case 'update_table': {
        const table = data.tables.find(t => t.id === msg.tableId);
        if (table) {
          if (msg.name) table.name = msg.name;
          if (msg.seats) table.seats = msg.seats;
          saveStoreData(storeId, data);
          broadcastToStore(storeId, { type: 'tables_updated', tables: data.tables });
        }
        break;
      }

      case 'close_day': {
        data.tables.forEach(t => {
          if (t.status === 'in_use') {
            endSession(data, t);
          }
          t.status = 'idle';
          t.sessionStart = null;
          t.duration = null;
          t.endTime = null;
        });

        const today = new Date().toISOString().split('T')[0];
        const todaySessions = data.sessions.filter(s => s.startTime.startsWith(today));
        data.archives = data.archives || [];
        data.archives.push({
          date: today,
          sessionCount: todaySessions.length,
          totalDuration: todaySessions.reduce((sum, s) => sum + s.duration, 0)
        });

        saveStoreData(storeId, data);
        broadcastToStore(storeId, { type: 'tables_updated', tables: data.tables });
        broadcastToStore(storeId, { type: 'stats_updated', stats: computeStats(data) });
        broadcastToStore(storeId, { type: 'day_closed', date: today, summary: computeStats(data, today) });
        break;
      }

      case 'get_stats': {
        ws.send(JSON.stringify({
          type: 'stats_data',
          stats: computeStats(data, msg.date)
        }));
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ================================');
  console.log('   \u62fc\u8c46\u5e97\u5de5\u4f4d\u7ba1\u7406\u7cfb\u7edf');
  console.log('  ================================');
  console.log(`  \u7aef\u53e3: ${PORT}`);
  console.log(`  \u8bbf\u95ee: http://localhost:${PORT}`);
  console.log('  ================================');
  console.log('');
});
