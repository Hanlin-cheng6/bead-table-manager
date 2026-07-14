// ==================== 状态 ====================
let tables = [];
let stats = null;
let ws = null;
let currentView = 'dashboard';
let selectedTableId = null;
let inUseModalTableId = null;
let selectedDurationMin = null;

// ==================== WebSocket ====================

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  if (!location.host) {
    updateConnStatus('disconnected', '错误：请通过 http://localhost:3000 访问，不要直接打开 HTML 文件');
    return;
  }

  updateConnStatus('connecting', '连接中...');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateConnStatus('connected', '已连接');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = (event) => {
    updateConnStatus('disconnected', `连接断开 (${event.code})，${event.wasClean ? '正常关闭' : '2秒后重连'}...`);
    if (!event.wasClean) {
      setTimeout(connect, 2000);
    }
  };

  ws.onerror = () => {
    updateConnStatus('disconnected', `连接失败: 无法连接 ${wsUrl}，请检查服务是否运行`);
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
  }
}

// ==================== 渲染 ====================

function renderAll() {
  renderStatsBar();
  renderDashboard();
  renderSettingsList();
  if (currentView === 'stats') renderStatsPanel();
}

// --- 统计条 ---
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

// --- 看板 ---
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

// --- 统计面板 ---
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

// --- 设置列表 ---
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

// --- 时长弹窗 ---
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

  send({ type: 'update_status', tableId: selectedTableId, status: 'in_use', durationMin: minutes });
  hideDurationModal();
}

// --- 使用中弹窗 ---
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
  // 倒计时
  document.querySelectorAll('.timer[data-end]').forEach(el => {
    const end = new Date(el.dataset.end).getTime();
    const remaining = end - Date.now();
    const card = el.closest('.table-card');

    if (remaining <= 0) {
      el.textContent = '时间到';
      el.className = 'timer timer-timeup';
      if (card) {
        card.classList.add('timeup');
        card.classList.remove('warning');
      }
    } else {
      el.textContent = formatClock(remaining);
      if (card) {
        card.classList.remove('timeup');
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

  // 正计时（无限时模式）
  document.querySelectorAll('.timer[data-start]').forEach(el => {
    if (el.dataset.end) return;
    const start = new Date(el.dataset.start).getTime();
    const elapsed = Date.now() - start;
    el.textContent = formatClock(elapsed);
    el.className = 'timer timer-normal';
  });

  // 更新使用中弹窗的剩余时间
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
  document.getElementById('clock').textContent = `${h}:${m}:${s}`;
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

// ==================== 视图切换 ====================

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });

  if (view === 'stats') renderStatsPanel();
}

// ==================== 初始化 ====================

function init() {
  // 导航
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // 添加桌位
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

  // 时长弹窗 - 快速选择
  document.querySelectorAll('#durationModal .duration-btn').forEach(btn => {
    btn.addEventListener('click', () => selectDuration(parseInt(btn.dataset.min)));
  });
  // 自定义输入清除快速选择
  document.getElementById('durationInput').addEventListener('input', () => {
    selectedDurationMin = null;
    document.querySelectorAll('#durationModal .duration-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
  });
  // 确认/取消
  document.getElementById('durationConfirm').addEventListener('click', confirmDuration);
  document.getElementById('durationCancel').addEventListener('click', hideDurationModal);
  // 回车确认
  document.getElementById('durationInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') confirmDuration();
  });

  // 使用中弹窗 - 延长按钮
  document.querySelectorAll('#inUseModal .duration-btn').forEach(btn => {
    btn.addEventListener('click', () => extendTime(parseInt(btn.dataset.min)));
  });
  // 关闭/结束
  document.getElementById('inUseClose').addEventListener('click', hideInUseModal);
  document.getElementById('inUseEnd').addEventListener('click', endInUseSession);

  // 获取访问地址
  fetch('/api/info').then(r => r.json()).then(info => {
    document.getElementById('accessInfo').innerHTML = `
      员工手机浏览器打开以下地址：<br>
      <code>http://${info.ip}:${info.port}</code><br><br>
      <span style="font-size:13px;color:var(--text-sec);">需连接同一 WiFi</span>
    `;
  });

  // 时钟
  updateClock();
  setInterval(updateClock, 1000);

  // 计时器
  setInterval(updateTimers, 1000);

  // WebSocket
  connect();
}

init();
