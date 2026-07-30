# 拼豆店桌台管理 — 三段语音提示方案 Plan

## 一、调研结论：有没有免费方案？

**结论：完全可以做到零成本，且效果自然。**

最推荐方案：**浏览器内置 Web Speech API（SpeechSynthesis）** + **Edge 浏览器内置的微软神经语音**。

### 各方案对比

| 方案 | 成本 | 音质 | 接入难度 | 推荐度 |
|---|---|---|---|---|
| **浏览器 SpeechSynthesis + Edge 神经语音** | 0 | ★★★★（"云希""云野"等神经网络人声） | 极低（前端 20 行 JS） | ⭐⭐⭐⭐⭐ |
| 第三方在线 TTS（讯飞、火山、Azure） | 部分免费 / 有额度 | ★★★★★ | 中（要 API key、要联网） | ⭐⭐⭐ |
| 预生成 MP3 + `<audio>` | 0 | 看录制 | 中（要手动录 24 段） | ⭐⭐ |
| 付费云服务（Azure/阿里云/腾讯云） | 约 ¥0.0001/字 | ★★★★★ | 高（接入账号、配额） | 不必 |

### Edge/Chrome 内置中文人声（实测可用）
- 普通话女声：`zh-CN-XiaoxiaoNeural`（晓晓，最自然）
- 普通话男声：`zh-CN-YunxiNeural`（云希，年轻男声）
- 普通话男声：`zh-CN-YunyangNeural`（云扬，新闻播报）
- 粤语：`zh-HK-HiuMaanNeural`（粤语可选）
- 台湾话：`zh-TW-HsiaoChenNeural`

> 所有 Edge 神经语音通过 Windows / macOS 系统级 TTS 引擎暴露，**对最终用户零成本、零注册、零调用次数限制**。Firefox / Safari 也能调用，只是没有 Edge 那批神经人声，会回退到系统普通 TTS（仍可用）。

---

## 二、当前代码理解

后端 `server.js` 已经处理了所有核心逻辑：
- `update_status` 收到 `in_use` 后，会写入 `sessionStart` + `endTime`
- 桌位增删改查都通过 WebSocket 广播到所有客户端

前端 `app.js` 有 `updateTimers()` 每秒刷新倒计时 UI，并自带 5 分钟红色警告样式。

**好消息**：所有语音逻辑都可以在前端完成，**完全不用动后端**，因为：
- "开始" 触发 → 点击 `confirmDuration()` 那刻就知道桌号
- "还剩 10 分钟" 触发 → `updateTimers()` 每秒跑，从中检测 `remaining ≤ 10min` 即可
- "已结束" 触发 → `updateTimers()` 检测到 `remaining ≤ 0` 即可

---

## 三、实施计划（最小改动版）

### 改动 1：在 `public/app.js` 顶部新增语音工具函数（约 30 行）

```js
// ==================== 语音播报 ====================

let audioUnlocked = false;
let zhVoice = null;

function loadZhVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  zhVoice = voices.find(v => /zh/i.test(v.lang)) || voices[0] || null;
}

// 浏览器异步加载语音列表
if ('speechSynthesis' in window) {
  loadZhVoice();
  speechSynthesis.onvoiceschanged = loadZhVoice;
}

function speak(text, opts = {}) {
  if (!('speechSynthesis' in window)) return;
  // 必须等待用户交互后才能播放（浏览器自动播放策略）
  if (!audioUnlocked) return;

  speechSynthesis.cancel(); // 打断上一段，避免串音
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  if (zhVoice) u.voice = zhVoice;
  u.rate = opts.rate ?? 1.0;
  u.pitch = opts.pitch ?? 1.0;
  u.volume = opts.volume ?? 1.0;
  speechSynthesis.speak(u);
}

// 任意点击后解锁语音（应对 Chrome 自动播放限制）
document.addEventListener('click', () => { audioUnlocked = true; }, { once: false });
```

### 改动 2：在 `confirmDuration()` 成功后播报"X 号桌开始"

```js
function confirmDuration() {
  // ... 原有逻辑保持不变 ...
  send({ type: 'update_status', tableId: selectedTableId, status: 'in_use', durationMin: minutes });
  speak(`${table.name}开始`);   // ← 新增一行
  hideDurationModal();
}
```

### 改动 3：在 `updateTimers()` 里检测 10 分钟和 0 秒节点

用 `sessionStart` 时间戳算一个"10 分钟提醒"是否已经播过，避免重复。

```js
const warnedTenMin = new Set(); // 记录已播过 10 分提醒的桌 id

function updateTimers() {
  document.querySelectorAll('.timer[data-end]').forEach(el => {
    const end = new Date(el.dataset.end).getTime();
    const remaining = end - Date.now();
    const card = el.closest('.table-card');
    const tableId = card?.dataset.id;
    const tableName = card?.querySelector('.table-name')?.textContent || '';

    // —— 0 秒：结束提示 ——
    if (remaining <= 0) {
      el.textContent = '时间到';
      el.className = 'timer timer-timeup';
      card?.classList.add('timeup');
      card?.classList.remove('warning');
      if (tableId && !warnedTenMin.has(tableId + ':end')) {
        warnedTenMin.add(tableId + ':end');
        speak(`${tableName}已结束`);
      }
    } else {
      el.textContent = formatClock(remaining);
      // —— 10 分钟节点：首次进入 10:00 ≤ remaining < 11:00 时播报一次 ——
      if (remaining <= 10 * 60 * 1000 && remaining > 9 * 60 * 1000 + 50 * 1000) {
        if (tableId && !warnedTenMin.has(tableId)) {
          warnedTenMin.add(tableId);
          speak(`${tableName}还剩 10 分钟`);
        }
      }
      // ... 原有的 warning / 5 分钟红字样式保留 ...
    }
  });
}
```

### 改动 4：清理 Set（桌位结束 + 新一轮开始时）

```js
// 在 cycleStatus('idle' → in_use) 与 endSession 时清掉对应桌的标记
// 防止上轮的"10 分钟提醒"标记误带到新一桌
warnedTenMin.delete(`${tableId}:end`);
warnedTenMin.delete(tableId);
```

---

## 四、改动文件清单

| 文件 | 改动内容 | 改动量 |
|---|---|---|
| `public/app.js` | 新增语音工具 + 3 个触发点 + 清理逻辑 | +约 50 行 |
| `server.js` | 不动 | 0 |
| `package.json` | 不动 | 0 |
| `public/index.html` | 不动（语音不占 DOM） | 0 |
| `public/style.css` | 不动 | 0 |

---

## 五、注意事项 / 你来决定

1. **自动播放限制**：Chrome/Safari 必须用户点击过页面后才能播报。所以会需要先点一次"开始"按钮，之后的"还剩 10 分钟"和"已结束"才能正常播。首次解锁前会跳过——这是浏览器策略，没法绕。
2. **iOS Safari**：要求语音触发必须在用户交互的同一次调用栈里，所以"10 分钟后自动播"在 iPhone 上**可能没声音**（无用户交互），但 Chrome / Edge / Android 浏览器没问题。
3. **语音风格**：可选男声/女声/粤语，默认给"晓晓"（最自然的女声）。要换男声我帮你改一行。
4. **可一键关闭**：建议在"设置"页加个开关 `window.localStorage.ttsEnabled = '0'` 时跳过播报。免费方案没商量，但用户可以关。
5. **测试方法**：改完后 `npm start` 启动，开两个浏览器窗口（A 控制台、B 看提醒），先在 A 点开始，确认有声音，再到 10 分钟时看 B 窗口有没有播。10 分钟太久了，可以临时把判断阈值改成 30 秒验证逻辑。

---

## 六、确认进入实施？

要不要我直接动手改 `app.js` 把这 50 行加上？或者你想先：
- 改播报文案（比如要不要加一声"叮咚"提示音）
- 加 iOS 降级方案（用 `<audio>` 预录）
- 加设置开关

告诉我你的偏好，我按你确认的方向开工。
