# 拼豆店桌台管理 — 商品售卖功能方案

## 状态：Plan 阶段（未开始实施）

---

## 一、支付系统：不需要接入

对小型实体拼豆店，**微信/支付宝个人收款码 + 店员手动确认**是最佳方案。

- 接入支付 API 需要企业资质、商户签约、开发联调，周期 2-4 周
- 个人收款码的体验：顾客扫码 → 店员听微信到账提示音 → 在系统中点「已付款」→ 完成
- 收款码可以直接展示在系统界面上（一张图片），无需任何 API

---

## 二、新增数据模型

### 商品 — `products_{storeId}.json`

```json
{
  "id": "p001",
  "name": "星之卡比拼豆套装",
  "category": "套装",
  "price": 39.9,
  "stock": 20,
  "unit": "套",
  "image": "",
  "active": true,
  "createdAt": "2026-07-30T14:00:00Z"
}
```

### 订单 — `orders_{storeId}.json`

```json
{
  "id": "o2307300001",
  "tableId": "t3",
  "tableName": "3号桌",
  "items": [
    { "productId": "p001", "name": "星之卡比套装", "qty": 2, "price": 39.9 }
  ],
  "totalAmount": 79.8,
  "status": "paid",
  "paymentMethod": "微信",
  "createdAt": "2026-07-30T14:30:00Z",
  "paidAt": "2026-07-30T14:32:00Z"
}
```

---

## 三、后端新增 API

| 接口 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `GET /api/products` | REST | token | 获取商品列表 |
| `POST /api/products` | REST | token | 新增/编辑商品 |
| `DELETE /api/products/:id` | REST | token | 删除商品 |
| `POST /api/orders` | REST | token | 创建订单（关联桌号） |
| `PUT /api/orders/:id/status` | REST | token | 更新状态 (pending/paid/cancelled) |
| `GET /api/orders` | REST | token | 查询订单列表（含日期筛选） |

- 全部沿用现有 token + IP 绑定 + 限流中间件
- `server.js` 新增约 100 行

---

## 四、前端改动

导航新增两个标签页：

```
看板 | 统计 | 商品 | 订单 | 设置
```

### 商品页（view-products）
- 商品卡片网格，按分类筛选
- 「新增商品」按钮 → 弹窗表单
- 点击商品 → 下单弹窗
- `public/index.html` +80 行, `public/app.js` +80 行

### 下单弹窗（orderModal）
- 选择关联桌号（自动列出使用中/空闲桌位）
- 选择商品数量
- 自动计算总价
- 确认下单 → 生成 pending 订单
- `public/index.html` +30 行, `public/app.js` +60 行

### 订单页（view-orders）
- 状态分栏（待付款 / 已付款 / 已取消）
- 每行：桌号、商品、金额、状态、时间
- 「标记已付款」按钮
- 今日营业额汇总卡片
- `public/index.html` +40 行, `public/app.js` +80 行

### 样式
- 商品卡片、订单表格、下单弹窗
- `public/style.css` +60 行

---

## 五、支付流程

```
顾客选好商品
  ↓
店员在系统下单 → 订单状态 = pending
  ↓
店员展示微信/支付宝个人收款码（可嵌入页面）
  ↓
顾客扫码付款
  ↓
店员听到到账提示音 → 点击「标记已付款」
  ↓
订单状态 = paid → 计入今日营业额
```

---

## 六、改动量总结

| 文件 | 改动 | 预估行数 |
|---|---|---|
| `server.js` | 新增 6 个 REST API | ~100 |
| `public/index.html` | 商品页 + 订单页 + 下单弹窗 | ~150 |
| `public/app.js` | 商品/订单前端逻辑 | ~220 |
| `public/style.css` | 新增 UI 样式 | ~60 |
| **合计** | **4 个文件** | **~530 行** |

零新增依赖，零新增 npm 包，零架构变更。

---

## 七、部署安全说明

- 本地 `/bead-table-manager/` 是开发环境，改代码不影响线上
- 线上服务器 `/opt/bead-table-manager/` 只有在 `git push + SSH git pull + pm2 restart` 三步后才更新
- 不存在自动同步或 CI/CD，完全由人工控制发布时间
- 完成后一次性推送到生产环境，中间可随时在本地 `npm start` 预览

---

## 八、后续升级路径

如果将来需要自动收款（非人工确认）：
- 微信支付 JSAPI 支付（公众号内 H5）
- 在现有订单模型上加 `transactionId` 字段
- 收到微信回调自动 `pending → paid`
- 商品和订单底子不动，只加支付层

---

## 九、待用户确认的问题

1. 商品是否需要分类？（如：套装 / 单色珠 / 工具 / 其他）
2. 是否需要库存管理？（自动扣减、低库存预警）
3. 收款码图片直接嵌入页面，还是店员自己拿手机展示？
4. 订单是否需要关联到具体桌号？（还是只记录金额不记桌号）
