// ==================== 语音播报 ====================

let audioUnlocked = false;
let zhVoice = null;
let warnedTimers = {};  // key: tableId -> { tenMin: boolean, ended: boolean }

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  zhVoice = voices.find(v => /zh/i.test(v.lang) && !/yue|cmn/i.test(v.lang + v.name))
         || voices.find(v => /zh/i.test(v.lang))
         || voices[0]
         || null;
}

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(text, opts = {}) {
  if (!('speechSynthesis' in window)) return;
  if (!audioUnlocked) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate  = opts.rate  ?? 1.0;
    u.pitch = opts.pitch ?? 1.0;
    u.volume = opts.volume ?? 1.0;
    speechSynthesis.speak(u);
  } catch (e) {
    // 无声卡、无 TTS 引擎等情况静默跳过
  }
}

document.addEventListener('click', () => { audioUnlocked = true; }, { once: false });

// ==================== 认证逻辑 ====================

let authToken = localStorage.getItem('token') || '';
let currentStoreId = null;
let currentStoreName = '';

function showAuth() {
  document.getElementById('authApp').style.display = '';
  document.getElementById('storeApp').style.display = 'none';
  showLoginForm();
}

function showStoreApp() {
  document.getElementById('authApp').style.display = 'none';
  document.getElementById('storeApp').style.display = '';
}

function showLoginForm() {
  document.getElementById('loginForm').style.display = '';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('forgotPasswordForm').style.display = 'none';
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

function showRegisterForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = '';
  document.getElementById('forgotPasswordForm').style.display = 'none';
  document.getElementById('registerError').style.display = 'none';
  document.getElementById('regStoreName').value = '';
  document.getElementById('regUsername').value = '';
  document.getElementById('regPassword').value = '';
  document.getElementById('regPassword2').value = '';
}

function showForgotPasswordForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('forgotPasswordForm').style.display = '';
  document.getElementById('forgotPasswordError').style.display = 'none';
  document.getElementById('fpUsername').value = '';
  document.getElementById('fpStoreName').value = '';
  document.getElementById('fpPassword').value = '';
  document.getElementById('fpPassword2').value = '';
}

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');

  if (!username || !password) {
    errEl.textContent = '请输入用户名和密码';
    errEl.style.display = '';
    return;
  }

  errEl.style.display = 'none';
  document.getElementById('loginBtn').textContent = '登录中...';
  document.getElementById('loginBtn').disabled = true;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
      authToken = data.token;
      currentStoreId = data.storeId;
      currentStoreName = data.storeName;
      localStorage.setItem('token', authToken);
      enterStore();
    } else {
      let msg = data.error || '登录失败';
      // 429/401 可能包含 attempts / remaining / lockSeconds
      if (res.status === 429 && data.lockSeconds) {
        const min = Math.ceil(data.lockSeconds / 60);
        msg = `登录失败次数过多，请 ${min} 分钟后重试`;
      } else if (typeof data.remaining === 'number' && data.remaining > 0) {
        msg = `密码错误，已失败 ${data.attempts || 1} 次，还剩 ${data.remaining} 次机会`;
      } else if (data.locked) {
        const min = Math.ceil((data.lockSeconds || 0) / 60);
        msg = `密码错误次数过多，已锁定 ${min} 分钟，请找回密码或稍后再试`;
      } else if (data.attempts) {
        msg = `密码错误，已失败 ${data.attempts} 次`;
      }
      errEl.textContent = msg;
      errEl.style.display = '';
    }
  } catch {
    errEl.textContent = '网络错误，请重试';
    errEl.style.display = '';
  } finally {
    document.getElementById('loginBtn').textContent = '登录';
    document.getElementById('loginBtn').disabled = false;
  }
}

async function doResetPassword() {
  const username = document.getElementById('fpUsername').value.trim();
  const storeName = document.getElementById('fpStoreName').value.trim();
  const password = document.getElementById('fpPassword').value;
  const password2 = document.getElementById('fpPassword2').value;
  const errEl = document.getElementById('forgotPasswordError');

  if (!username || !storeName || !password) {
    errEl.textContent = '请填写所有字段';
    errEl.style.display = '';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = '新密码至少6位';
    errEl.style.display = '';
    return;
  }
  if (password !== password2) {
    errEl.textContent = '两次密码输入不一致';
    errEl.style.display = '';
    return;
  }

  errEl.style.display = 'none';
  document.getElementById('resetPasswordBtn').textContent = '重置中...';
  document.getElementById('resetPasswordBtn').disabled = true;

  try {
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, storeName, password })
    });
    const data = await res.json();

    if (res.ok) {
      alert('密码重置成功，请用新密码登录');
      showLoginForm();
      document.getElementById('loginUsername').value = username;
    } else {
      errEl.textContent = data.error || '重置失败';
      errEl.style.display = '';
    }
  } catch {
    errEl.textContent = '网络错误，请重试';
    errEl.style.display = '';
  } finally {
    document.getElementById('resetPasswordBtn').textContent = '确认重置';
    document.getElementById('resetPasswordBtn').disabled = false;
  }
}

async function doRegister() {
  const storeName = document.getElementById('regStoreName').value.trim();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const password2 = document.getElementById('regPassword2').value;
  const errEl = document.getElementById('registerError');

  if (!storeName || !username || !password) {
    errEl.textContent = '请填写所有字段';
    errEl.style.display = '';
    return;
  }
  if (password !== password2) {
    errEl.textContent = '两次密码输入不一致';
    errEl.style.display = '';
    return;
  }

  errEl.style.display = 'none';
  document.getElementById('registerBtn').textContent = '注册中...';
  document.getElementById('registerBtn').disabled = true;

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, storeName })
    });
    const data = await res.json();

    if (res.ok) {
      authToken = data.token;
      currentStoreId = data.storeId;
      currentStoreName = data.storeName;
      localStorage.setItem('token', authToken);
      enterStore();
    } else {
      errEl.textContent = data.error || '注册失败';
      errEl.style.display = '';
    }
  } catch {
    errEl.textContent = '网络错误，请重试';
    errEl.style.display = '';
  } finally {
    document.getElementById('registerBtn').textContent = '注册';
    document.getElementById('registerBtn').disabled = false;
  }
}

function doLogout() {
  authToken = '';
  currentStoreId = null;
  currentStoreName = '';
  localStorage.removeItem('token');
  if (ws) {
    ws.close();
    ws = null;
  }
  showAuth();
}

async function checkAuth() {
  if (!authToken) {
    showAuth();
    return;
  }
  try {
    const res = await fetch('/api/me', {
      headers: { 'x-token': authToken }
    });
    if (res.ok) {
      const data = await res.json();
      currentStoreId = data.storeId;
      currentStoreName = data.storeName;
      enterStore();
    } else {
      authToken = '';
      localStorage.removeItem('token');
      showAuth();
    }
  } catch {
    showAuth();
  }
}

function enterStore() {
  showStoreApp();
  document.getElementById('storeTitle').textContent = currentStoreName || '拼豆工位管理';
  document.getElementById('storeSub').textContent = currentStoreName || 'Bead Workshop';

  // 访问地址
  document.getElementById('accessInfo').innerHTML = `
    员工手机浏览器打开以下地址：<br>
    <code>${location.origin}</code><br><br>
    <span style="font-size:13px;color:var(--text-sec);">使用同一账号登录即可，无需连接同一 WiFi</span>
  `;

  // 重置状态
  tables = [];
  stats = null;
  currentView = 'dashboard';
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === 'dashboard');
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-dashboard');
  });

  // 清理旧定时器（防止退出再登录后定时器泄漏）
  if (clockInterval) clearInterval(clockInterval);
  if (timerInterval) clearInterval(timerInterval);

  // 时钟
  updateClock();
  clockInterval = setInterval(updateClock, 1000);
  timerInterval = setInterval(updateTimers, 1000);

  // WebSocket
  connectStore();
}

// ==================== 店铺工位管理 ====================

let tables = [];
let stats = null;
let ws = null;
let currentView = 'dashboard';
let selectedTableId = null;
let inUseModalTableId = null;
let selectedDurationMin = null;
let clockInterval = null;
let timerInterval = null;

function connectStore() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/?token=${authToken}`;

  updateConnStatus('connecting', '连接中...');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateConnStatus('connected', '已连接');
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = (event) => {
    if (event.code === 1008) {
      // token 无效，需要重新登录
      updateConnStatus('disconnected', '登录已过期');
      setTimeout(() => doLogout(), 1500);
      return;
    }
    updateConnStatus('disconnected', `连接断开 (${event.code})，2秒后重连...`);
    if (!event.wasClean) {
      setTimeout(() => {
        if (authToken) connectStore();
      }, 2000);
    }
  };

  ws.onerror = () => {
    updateConnStatus('disconnected', '连接失败: 无法连接服务器');
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function updateConnStatus(status, text) {
  const bar = document.getElementById('connBar');
  bar.className = `conn-bar ${status === 'connecting' ? '' : status}`;
  bar.querySelector('.conn-text').textContent = text;
}

// ==================== 消息处理 ====================

function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      tables = msg.tables;
      stats = msg.stats;
      currentStoreName = msg.storeName || currentStoreName || '';
      document.getElementById('storeTitle').textContent = currentStoreName || '拼豆工位管理';
      document.getElementById('storeSub').textContent = currentStoreName || 'Bead Workshop';
      renderAll();
      break;
    case 'tables_updated':
      tables = msg.tables;
      renderDashboard();
      renderSettingsList();
      if (inUseModalTableId) {
        const t = tables.find(t => t.id === inUseModalTableId);
        if (t && t.status === 'in_use') {
          updateInUseModal(t);
        } else {
          hideInUseModal();
        }
      }
      break;
    case 'stats_updated':
      stats = msg.stats;
      renderStatsBar();
      if (currentView === 'stats') renderStatsPanel();
      break;
    case 'day_closed':
      stats = msg.summary;
      renderAll();
      hideInUseModal();
      alert(`收班完成！\n日期: ${msg.date}\n总桌次: ${msg.summary.totalSessions}\n平均用时: ${formatDuration(msg.summary.avgDuration)}`);
      break;
    case 'stats_data':
      stats = msg.stats;
      renderStatsPanel();
      break;
    case 'error':
      updateConnStatus('disconnected', msg.message || '错误');
      break;
  }
}

// ==================== 渲染 ====================

function renderAll() {
  renderStatsBar();
  renderDashboard();
  renderSettingsList();
  if (currentView === 'stats') renderStatsPanel();
}

function renderStatsBar() {
  const bar = document.getElementById('statsBar');
  if (!stats) return;

  bar.innerHTML = `
    <div class="stat-chip"><div><div class="label">总桌数</div><div class="value">${stats.totalTables}</div></div></div>
    <div class="stat-chip idle"><div><div class="label">空闲</div><div class="value">${stats.currentIdle}</div></div></div>
    <div class="stat-chip in-use"><div><div class="label">使用中</div><div class="value">${stats.currentInUse}</div></div></div>
    <div class="stat-chip cleaning"><div><div class="label">待清理</div><div class="value">${stats.currentCleaning}</div></div></div>
    <div class="stat-chip rate"><div><div class="label">上座率</div><div class="value">${stats.occupancyRate}%</div></div></div>
    <div class="stat-chip"><div><div class="label">今日桌次</div><div class="value">${stats.totalSessions}</div></div></div>
  `;
}

function renderDashboard() {
  const grid = document.getElementById('tableGrid');
  if (tables.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-sec);text-align:center;padding:40px;">暂无桌位，请在设置中添加</p>';
    return;
  }

  grid.innerHTML = tables.map(t => {
    const statusLabel = getStatusLabel(t.status);
    let timerHtml = '';
    let extraHtml = '';

    if (t.status === 'in_use' && t.sessionStart) {
      if (t.endTime) {
        timerHtml = `<div class="timer" data-end="${t.endTime}">--:--:--</div>`;
      } else {
        timerHtml = `<div class="timer" data-start="${t.sessionStart}">00:00:00</div>`;
      }
      extraHtml = `<div class="start-time">始于 ${formatTime(t.sessionStart)}</div>`;
    } else if (t.status === 'cleaning') {
      timerHtml = `<div class="hint-text">点击切换为空闲</div>`;
    } else {
      timerHtml = `<div class="hint-text">点击开始使用</div>`;
    }

    return `
      <div class="table-card ${t.status}" data-id="${t.id}" onclick="cycleStatus('${t.id}')">
        <div class="table-name">${t.name}</div>
        <div class="table-seats">${t.seats} 人桌</div>
        <div class="status-badge">${statusLabel}</div>
        ${timerHtml}
        ${extraHtml}
      </div>
    `;
  }).join('');

  updateTimers();
}

function renderStatsPanel() {
  const panel = document.getElementById('statsPanel');
  if (!stats) return;

  const maxCount = Math.max(...stats.tableStats.map(t => t.count), 1);

  const tableRows = stats.tableStats.map(t => `
    <tr>
      <td>${t.name}</td>
      <td>${t.count}</td>
      <td>${formatDuration(t.totalDuration)}</td>
      <td>${t.count > 0 ? formatDuration(t.totalDuration / t.count) : '--'}</td>
      <td>
        <div class="bar-cell">
          <div class="bar-track">
            <div class="bar-fill" style="width:${(t.count / maxCount * 100)}%"></div>
          </div>
          <span style="font-size:12px;color:var(--text-sec);min-width:24px;">${t.count}</span>
        </div>
      </td>
    </tr>
  `).join('');

  const hours = [];
  for (let h = 8; h <= 22; h++) {
    hours.push({ hour: h, count: stats.hourlyFlow[h] || 0 });
  }
  const maxHourly = Math.max(...hours.map(h => h.count), 1);
  const currentHour = new Date().getHours();

  const hourlyBars = hours.map(h => `
    <div class="hourly-bar">
      <span class="count">${h.count || ''}</span>
      <div class="bar ${h.hour === currentHour ? 'active' : ''}" style="height:${Math.max(h.count / maxHourly * 80, 3)}px"></div>
      <span class="hour-label">${h.hour}</span>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="stats-date">${stats.date} 数据统计</div>
    <div class="stats-cards">
      <div class="big-stat-card">
        <div class="label">今日总桌次</div>
        <div class="value">${stats.totalSessions}</div>
        <div class="sub">完成的使用次数</div>
      </div>
      <div class="big-stat-card">
        <div class="label">平均用时</div>
        <div class="value">${formatDuration(stats.avgDuration)}</div>
        <div class="sub">每桌平均时长</div>
      </div>
      <div class="big-stat-card">
        <div class="label">当前上座率</div>
        <div class="value">${stats.occupancyRate}%</div>
        <div class="sub">${stats.currentInUse}/${stats.totalTables} 桌使用中</div>
      </div>
      <div class="big-stat-card">
        <div class="label">总使用时长</div>
        <div class="value">${formatDuration(stats.totalDuration)}</div>
        <div class="sub">今日累计</div>
      </div>
    </div>
    <div class="hourly-chart">
      <h3>时段客流分布</h3>
      <div class="hourly-bars">${hourlyBars}</div>
    </div>
    <div class="stats-table">
      <h3>各桌位使用详情</h3>
      <table>
        <thead>
          <tr>
            <th>桌位</th>
            <th>桌次</th>
            <th>总时长</th>
            <th>平均</th>
            <th>使用频次</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function renderSettingsList() {
  const list = document.getElementById('tableSettingsList');
  if (tables.length === 0) {
    list.innerHTML = '<p style="color:var(--text-sec);font-size:14px;">暂无桌位</p>';
    return;
  }

  list.innerHTML = tables.map(t => `
    <div class="table-row">
      <span class="name">${t.name}</span>
      <span class="seats">${t.seats}人桌</span>
      <span class="status-tag ${t.status}">${getStatusLabel(t.status)}</span>
      <button class="btn-icon" onclick="removeTable('${t.id}')" title="删除">&times;</button>
    </div>
  `).join('');
}

// ==================== 操作 ====================

function cycleStatus(tableId) {
  const table = tables.find(t => t.id === tableId);
  if (!table) return;

  if (table.status === 'idle') {
    showDurationModal(table);
  } else if (table.status === 'in_use') {
    showInUseModal(table);
  } else if (table.status === 'cleaning') {
    send({ type: 'update_status', tableId, status: 'idle' });
  }
}

function showDurationModal(table) {
  selectedTableId = table.id;
  selectedDurationMin = null;
  document.getElementById('durationTableName').textContent = table.name;
  document.getElementById('durationInput').value = '';
  document.querySelectorAll('#durationModal .duration-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  document.getElementById('durationModal').style.display = 'flex';
}

function hideDurationModal() {
  document.getElementById('durationModal').style.display = 'none';
  selectedTableId = null;
  selectedDurationMin = null;
}

function selectDuration(min) {
  selectedDurationMin = min;
  document.querySelectorAll('#durationModal .duration-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.min) === min);
  });
  document.getElementById('durationInput').value = '';
}

function confirmDuration() {
  if (!selectedTableId) return;

  let minutes = selectedDurationMin;
  const customVal = parseInt(document.getElementById('durationInput').value);
  if (customVal > 0) {
    minutes = customVal;
  }

  if (!minutes || minutes < 1) {
    document.getElementById('durationInput').focus();
    return;
  }

  const table = tables.find(t => t.id === selectedTableId);
  send({ type: 'update_status', tableId: selectedTableId, status: 'in_use', durationMin: minutes });
  // 语音播报：开始
  const startName = table ? table.name : '';
  warnedTimers[selectedTableId] = { tenMin: false, ended: false };
  speak(`${startName}开始`);
  hideDurationModal();
}

function showInUseModal(table) {
  inUseModalTableId = table.id;
  document.getElementById('inUseTableName').textContent = table.name + ' - 使用中';
  updateInUseModal(table);
  document.getElementById('inUseModal').style.display = 'flex';
}

function updateInUseModal(table) {
  document.getElementById('inUseStartTime').textContent = formatTime(table.sessionStart);
  if (table.endTime) {
    const remaining = new Date(table.endTime).getTime() - Date.now();
    document.getElementById('inUseRemaining').textContent = remaining > 0 ? formatClock(remaining) : '时间到';
  } else {
    document.getElementById('inUseRemaining').textContent = '不限时';
  }
}

function hideInUseModal() {
  document.getElementById('inUseModal').style.display = 'none';
  inUseModalTableId = null;
}

function endInUseSession() {
  if (!inUseModalTableId) return;
  send({ type: 'update_status', tableId: inUseModalTableId, status: 'cleaning' });
  hideInUseModal();
}

function extendTime(minutes) {
  if (!inUseModalTableId) return;
  send({ type: 'extend_time', tableId: inUseModalTableId, minutes });
}

function addTable() {
  const nameInput = document.getElementById('newTableName');
  const seatsInput = document.getElementById('newTableSeats');
  const name = nameInput.value.trim();
  const seats = parseInt(seatsInput.value) || 4;

  if (!name) {
    nameInput.focus();
    return;
  }

  send({ type: 'add_table', name, seats });
  nameInput.value = '';
  seatsInput.value = '4';
}

function removeTable(tableId) {
  if (!confirm('确认删除这个桌位？')) return;
  send({ type: 'remove_table', tableId });
}

function closeDay() {
  const summary = `今日总桌次: ${stats?.totalSessions || 0}\n平均用时: ${formatDuration(stats?.avgDuration || 0)}\n当前使用中: ${stats?.currentInUse || 0} 桌`;
  document.getElementById('closeDaySummary').textContent = summary + '\n\n收班将结束所有使用中的桌位并归档数据。';
  document.getElementById('closeDayModal').style.display = 'flex';
}

function confirmCloseDay() {
  send({ type: 'close_day' });
  document.getElementById('closeDayModal').style.display = 'none';
}

// ==================== 定时器 ====================

function updateTimers() {
  document.querySelectorAll('.timer[data-end]').forEach(el => {
    const end = new Date(el.dataset.end).getTime();
    const remaining = end - Date.now();
    const card = el.closest('.table-card');
    const tableId = card ? card.dataset.id : null;
    const tableName = card ? card.querySelector('.table-name')?.textContent || '' : '';

    if (remaining <= 0) {
      el.textContent = '时间到';
      el.className = 'timer timer-timeup';
      if (card) {
        card.classList.add('timeup');
        card.classList.remove('warning');
      }
      // 语音播报：结束（仅首次）
      if (tableId && warnedTimers[tableId] && !warnedTimers[tableId].ended) {
        warnedTimers[tableId].ended = true;
        speak(`${tableName}已结束`);
      }
    } else {
      el.textContent = formatClock(remaining);
      if (card) {
        card.classList.remove('timeup');
        // 语音播报：还剩 10 分钟（仅首次）
        if (remaining <= 10 * 60 * 1000 && remaining > 9.5 * 60 * 1000) {
          if (tableId && warnedTimers[tableId] && !warnedTimers[tableId].tenMin) {
            warnedTimers[tableId].tenMin = true;
            speak(`${tableName}还剩10分钟`);
          }
        }
        if (remaining < 5 * 60 * 1000) {
          el.className = 'timer timer-warning';
          card.classList.add('warning');
        } else {
          el.className = 'timer timer-normal';
          card.classList.remove('warning');
        }
      }
    }
  });

  document.querySelectorAll('.timer[data-start]').forEach(el => {
    if (el.dataset.end) return;
    const start = new Date(el.dataset.start).getTime();
    const elapsed = Date.now() - start;
    el.textContent = formatClock(elapsed);
    el.className = 'timer timer-normal';
  });

  if (inUseModalTableId) {
    const table = tables.find(t => t.id === inUseModalTableId);
    if (table && table.status === 'in_use') {
      updateInUseModal(table);
    }
  }
}

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
}

// ==================== 工具函数 ====================

function formatClock(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(ms) {
  if (!ms || ms === 0) return '--';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}小时${m}分`;
  const s = Math.floor((ms % 60000) / 1000);
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function formatTime(iso) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function getStatusLabel(status) {
  return { idle: '空闲', in_use: '使用中', cleaning: '待清理' }[status] || status;
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.view) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });

  if (view === 'stats') renderStatsPanel();
  if (view === 'products') { loadProducts().then(() => renderProducts()); }
  if (view === 'orders') loadOrders();
}

// ==================== 商品管理 ====================

const PRESET_CATEGORIES = ['套装', '单色珠', '工具', '配件', '自定义'];
let products = [];
let currentProductImage = null; // File 对象
let selectedCategory = null;
let editingProductId = null;
let orders = [];
let ordersDate = new Date().toISOString().split('T')[0];
let ordersFilter = 'all';

async function loadProducts() {
  try {
    const res = await fetch('/api/products', { headers: { 'x-token': authToken } });
    if (res.ok) products = await res.json();
  } catch {}
}

function renderProducts() {
  // 分类栏
  const catBar = document.getElementById('categoryBar');
  catBar.innerHTML = PRESET_CATEGORIES.map(cat => {
    const active = selectedCategory === cat ? ' active' : '';
    return `<button class="cat-chip${active}" data-cat="${cat}">${cat}</button>`;
  }).join('');

  catBar.querySelectorAll('.cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategory = selectedCategory === btn.dataset.cat ? null : btn.dataset.cat;
      renderProducts();
    });
  });

  // 商品列表
  const grid = document.getElementById('productGrid');
  const filtered = selectedCategory ? products.filter(p => p.category === selectedCategory) : products;
  if (filtered.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-sec);text-align:center;padding:40px;">暂无商品，点击上方按钮添加</p>';
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const imgHtml = p.image
      ? `<img src="${p.image}" alt="${p.name}" class="product-img" loading="lazy">`
      : `<div class="product-img-placeholder">📦</div>`;
    const stockClass = p.stock <= 0 ? ' out' : p.stock <= 5 ? ' low' : '';
    return `
      <div class="product-card" data-id="${p.id}">
        ${imgHtml}
        <div class="product-info">
          <div class="product-cat">${p.category}</div>
          <div class="product-name">${p.name}</div>
          <div class="product-meta">
            <span class="product-price">¥${p.price.toFixed(2)}</span>
            <span class="product-stock${stockClass}">库存: ${p.stock}</span>
            <span class="product-unit">/${p.unit}</span>
          </div>
          <div class="product-actions">
            <button class="btn btn-sm" onclick="event.stopPropagation();openOrderModalForProduct('${p.id}')">下单</button>
            <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();editProduct('${p.id}')">编辑</button>
            <button class="btn btn-sm btn-ghost btn-danger-text" onclick="event.stopPropagation();deleteProduct('${p.id}')">删除</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function showProductModal(product = null) {
  editingProductId = product ? product.id : null;
  document.getElementById('productModalTitle').textContent = product ? '编辑商品' : '新增商品';
  document.getElementById('productEditId').value = product ? product.id : '';
  document.getElementById('productName').value = product ? product.name : '';
  document.getElementById('productPrice').value = product ? product.price : '';
  document.getElementById('productStock').value = product ? product.stock : '';
  document.getElementById('productUnit').value = product ? (product.unit || '个') : '个';
  currentProductImage = null;

  // 重置图片预览
  const preview = document.getElementById('imagePreview');
  if (product && product.image) {
    preview.innerHTML = `<img src="${product.image}" alt="预览">`;
  } else {
    preview.innerHTML = '<span>点击上传图片</span>';
  }

  // 分类选择
  let targetCat = product ? product.category : null;
  const catContainer = document.getElementById('productCategory');
  catContainer.innerHTML = PRESET_CATEGORIES.map(cat => {
    const active = targetCat === cat ? ' active' : '';
    return `<button class="cat-chip${active}" data-cat="${cat}">${cat}</button>`;
  }).join('');
  catContainer.querySelectorAll('.cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      targetCat = btn.dataset.cat;
      catContainer.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('productCustomCategory').style.display = btn.dataset.cat === '自定义' ? '' : 'none';
    });
  });

  if (targetCat === '自定义' && product) {
    document.getElementById('productCustomCategory').value = product.category;
    document.getElementById('productCustomCategory').style.display = '';
  } else {
    document.getElementById('productCustomCategory').style.display = 'none';
  }

  document.getElementById('productModal').style.display = 'flex';
}

function hideProductModal() {
  document.getElementById('productModal').style.display = 'none';
  editingProductId = null;
  currentProductImage = null;
}

async function saveProduct() {
  const name = document.getElementById('productName').value.trim();
  const price = document.getElementById('productPrice').value;
  const stock = document.getElementById('productStock').value;
  const unit = document.getElementById('productUnit').value.trim();

  let category = selectedCategory;
  // 从弹窗中获取当前选中分类
  const activeCat = document.querySelector('#productCategory .cat-chip.active');
  if (activeCat) category = activeCat.dataset.cat;
  if (category === '自定义') {
    const custom = document.getElementById('productCustomCategory').value.trim();
    if (custom) category = custom;
  }

  if (!name) {
    document.getElementById('productName').focus();
    return;
  }
  if (!category) {
    alert('请选择分类');
    return;
  }

  // 用于恢复选中状态
  selectedCategory = null;

  const formData = new FormData();
  formData.append('name', name);
  formData.append('category', category);
  formData.append('price', price || '0');
  formData.append('stock', stock || '0');
  formData.append('unit', unit || '个');
  if (editingProductId) formData.append('id', editingProductId);
  if (currentProductImage) formData.append('image', currentProductImage);

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'x-token': authToken },
      body: formData
    });
    if (res.ok) {
      await loadProducts();
      renderProducts();
      hideProductModal();
    } else {
      const d = await res.json();
      alert(d.error || '保存失败');
    }
  } catch {
    alert('网络错误');
  }
}

async function editProduct(id) {
  const p = products.find(x => x.id === id);
  if (p) showProductModal(p);
}

async function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`确认删除商品「${p.name}」？`)) return;
  try {
    const res = await fetch(`/api/products/${id}`, {
      method: 'DELETE',
      headers: { 'x-token': authToken }
    });
    if (res.ok) {
      await loadProducts();
      renderProducts();
    }
  } catch {}
}

// ==================== 订单管理 ====================

async function loadOrders() {
  try {
    const res = await fetch(`/api/orders?date=${ordersDate}`, {
      headers: { 'x-token': authToken }
    });
    if (res.ok) {
      const data = await res.json();
      orders = data.orders;
      renderOrders();
    }
  } catch {}
}

function renderOrders() {
  // 营业额汇总
  let totalPaid = orders.filter(o => o.status === 'paid').reduce((s, o) => s + o.totalAmount, 0);
  const pendingCount = orders.filter(o => o.status === 'pending').length;
  document.getElementById('ordersSummary').innerHTML = `
    <div class="big-stat-card">
      <div class="label">今日营业额</div>
      <div class="value">¥${totalPaid.toFixed(2)}</div>
      <div class="sub">${ordersDate}</div>
    </div>
    <div class="big-stat-card">
      <div class="label">待付款</div>
      <div class="value">${pendingCount}</div>
      <div class="sub">笔订单</div>
    </div>
    <div class="big-stat-card">
      <div class="label">总订单</div>
      <div class="value">${orders.length}</div>
      <div class="sub">今日</div>
    </div>
  `;

  // 订单列表
  const list = document.getElementById('ordersList');
  const filtered = ordersFilter === 'all' ? orders : orders.filter(o => o.status === ordersFilter);
  if (filtered.length === 0) {
    list.innerHTML = '<p style="color:var(--text-sec);text-align:center;padding:40px;">暂无订单</p>';
    return;
  }

  list.innerHTML = filtered.map(o => {
    const itemsText = o.items.map(i => `${i.name}×${i.qty}`).join('、');
    const statusLabel = { pending: '待付款', paid: '已付款', cancelled: '已取消' }[o.status];
    const statusClass = `order-status ${o.status}`;
    const time = new Date(o.createdAt);
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
    const actions = o.status === 'pending'
      ? `<button class="btn btn-sm btn-success" onclick="updateOrderStatus('${o.id}','paid')">标记已付款</button>
         <button class="btn btn-sm btn-ghost" onclick="updateOrderStatus('${o.id}','cancelled')">取消</button>`
      : `<span style="font-size:12px;color:var(--text-sec);">${o.paidAt ? formatTime(o.paidAt) : ''}</span>`;

    return `
      <div class="order-card ${o.status}">
        <div class="order-header">
          <span class="${statusClass}">${statusLabel}</span>
          <span class="order-table">${o.tableName}</span>
          <span class="order-time">${timeStr}</span>
        </div>
        <div class="order-items-text">${itemsText}</div>
        <div class="order-footer">
          <span class="order-amount">¥${o.totalAmount.toFixed(2)}</span>
          <span class="order-payment">${o.paymentMethod}</span>
          <div class="order-actions">${actions}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function updateOrderStatus(id, status) {
  try {
    const res = await fetch(`/api/orders/${id}/status`, {
      method: 'PUT',
      headers: { 'x-token': authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      await loadOrders();
      // 也刷新商品列表（库存可能有变化）
      await loadProducts();
      if (currentView === 'products') renderProducts();
    }
  } catch {}
}

// ==================== 下单弹窗 ====================

let orderTableId = null;
let orderItemRows = []; // [{ productId, qty, price }]

function openOrderModalForProduct(productId) {
  orderTableId = null;
  orderItemRows = [{ productId, qty: 1, price: 0 }];
  renderOrderModal();
  document.getElementById('orderModal').style.display = 'flex';
}

function openOrderModal() {
  orderTableId = null;
  orderItemRows = [{ productId: '', qty: 1, price: 0 }];
  renderOrderModal();
  document.getElementById('orderModal').style.display = 'flex';
}

function hideOrderModal() {
  document.getElementById('orderModal').style.display = 'none';
}

function renderOrderModal() {
  // 桌号选择
  const select = document.getElementById('orderTableId');
  // 列出使用中和空闲的桌号
  const availableTables = tables.filter(t => t.status === 'in_use' || t.status === 'idle');
  select.innerHTML = '<option value="">请选择桌号</option>' +
    '<option value="__none__">其它（不关联桌号）</option>' +
    availableTables.map(t => `<option value="${t.id}">${t.name}（${getStatusLabel(t.status)}）</option>`).join('');
  if (orderTableId) select.value = orderTableId;

  select.onchange = () => { orderTableId = select.value; };

  // 商品行
  const container = document.getElementById('orderItems');
  container.innerHTML = orderItemRows.map((row, idx) => {
    const productOpts = products.map(p => {
      const selected = p.id === row.productId ? ' selected' : '';
      return `<option value="${p.id}"${selected}>${p.name}（¥${p.price.toFixed(2)}，库存:${p.stock}）</option>`;
    }).join('');
    const selectedProduct = products.find(p => p.id === row.productId);
    return `
      <div class="order-item-row">
        <select class="input order-item-product" data-idx="${idx}">
          <option value="">选择商品</option>
          ${productOpts}
        </select>
        <input type="number" class="input order-item-qty" value="${row.qty}" min="1" data-idx="${idx}" style="width:70px;">
        ${idx > 0 ? `<button class="btn btn-sm btn-ghost order-item-remove" data-idx="${idx}">✕</button>` : ''}
      </div>
    `;
  }).join('');

  // 事件绑定
  container.querySelectorAll('.order-item-product').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      orderItemRows[idx].productId = sel.value;
      updateOrderTotal();
    });
  });
  container.querySelectorAll('.order-item-qty').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.dataset.idx);
      orderItemRows[idx].qty = parseInt(inp.value) || 1;
      updateOrderTotal();
    });
  });
  container.querySelectorAll('.order-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      orderItemRows.splice(idx, 1);
      renderOrderModal();
    });
  });

  updateOrderTotal();
}

function updateOrderTotal() {
  let total = 0;
  orderItemRows.forEach(row => {
    const p = products.find(x => x.id === row.productId);
    if (p) total += p.price * row.qty;
  });
  document.getElementById('orderTotal').textContent = `¥${total.toFixed(2)}`;
}

async function confirmOrder() {
  if (!orderTableId || orderTableId === '__none__') {
    // 不强制要求桌号，但订单里标注为"其它"
    orderTableId = '__none__';
  }
  const items = orderItemRows.filter(r => r.productId && r.qty > 0);
  if (items.length === 0) {
    alert('请至少选择一个商品');
    return;
  }
  const table = orderTableId === '__none__' ? null : tables.find(t => t.id === orderTableId);

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'x-token': authToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId: table ? table.id : null,
        tableName: table ? table.name : '其它',
        items: items.map(r => ({ productId: r.productId, qty: r.qty })),
        paymentMethod: '微信'
      })
    });
    if (res.ok) {
      hideOrderModal();
      await loadProducts();
      if (currentView === 'products') renderProducts();
      alert('下单成功！请向顾客收款。');
    } else {
      const d = await res.json();
      alert(d.error || '下单失败');
    }
  } catch {
    alert('网络错误');
  }
}

function bindEvents() {
  // 认证
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginPassword').addEventListener('keypress', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('loginUsername').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('loginPassword').focus();
  });

  document.getElementById('registerBtn').addEventListener('click', doRegister);
  document.getElementById('regPassword2').addEventListener('keypress', e => {
    if (e.key === 'Enter') doRegister();
  });

  document.getElementById('toRegister').addEventListener('click', showRegisterForm);
  document.getElementById('toLogin').addEventListener('click', showLoginForm);
  document.getElementById('toForgotPassword').addEventListener('click', showForgotPasswordForm);
  document.getElementById('toLoginFromForgot').addEventListener('click', showLoginForm);
  document.getElementById('logoutBtn').addEventListener('click', doLogout);

  document.getElementById('resetPasswordBtn').addEventListener('click', doResetPassword);
  document.getElementById('fpPassword2').addEventListener('keypress', e => {
    if (e.key === 'Enter') doResetPassword();
  });

  // 导航
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.view) {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    }
  });

  // 桌位管理
  document.getElementById('addTableBtn').addEventListener('click', addTable);
  document.getElementById('newTableName').addEventListener('keypress', e => {
    if (e.key === 'Enter') addTable();
  });

  // 收班
  document.getElementById('closeDayBtn').addEventListener('click', closeDay);
  document.getElementById('closeDayCancel').addEventListener('click', () => {
    document.getElementById('closeDayModal').style.display = 'none';
  });
  document.getElementById('closeDayConfirm').addEventListener('click', confirmCloseDay);

  // 时长弹窗
  document.querySelectorAll('#durationModal .duration-btn').forEach(btn => {
    btn.addEventListener('click', () => selectDuration(parseInt(btn.dataset.min)));
  });
  document.getElementById('durationInput').addEventListener('input', () => {
    selectedDurationMin = null;
    document.querySelectorAll('#durationModal .duration-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
  });
  document.getElementById('durationConfirm').addEventListener('click', confirmDuration);
  document.getElementById('durationCancel').addEventListener('click', hideDurationModal);
  document.getElementById('durationInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') confirmDuration();
  });

  // 使用中弹窗
  document.querySelectorAll('#inUseModal .duration-btn').forEach(btn => {
    btn.addEventListener('click', () => extendTime(parseInt(btn.dataset.min)));
  });
  document.getElementById('inUseClose').addEventListener('click', hideInUseModal);
  document.getElementById('inUseEnd').addEventListener('click', endInUseSession);

  // ===== 商品管理 =====
  document.getElementById('addProductBtn').addEventListener('click', () => showProductModal());
  document.getElementById('productCancel').addEventListener('click', hideProductModal);
  document.getElementById('productSave').addEventListener('click', saveProduct);
  document.getElementById('imageUploadArea').addEventListener('click', () => {
    document.getElementById('productImage').click();
  });
  document.getElementById('productImage').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      currentProductImage = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('imagePreview').innerHTML = `<img src="${ev.target.result}" alt="预览">`;
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });

  // ===== 订单管理 =====
  document.getElementById('addOrderItemBtn').addEventListener('click', () => {
    orderItemRows.push({ productId: '', qty: 1, price: 0 });
    renderOrderModal();
  });
  document.getElementById('orderCancel').addEventListener('click', hideOrderModal);
  document.getElementById('orderConfirm').addEventListener('click', confirmOrder);
  document.querySelectorAll('.order-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.order-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ordersFilter = btn.dataset.status;
      renderOrders();
    });
  });
}

// ==================== 启动 ====================

bindEvents();
checkAuth();
