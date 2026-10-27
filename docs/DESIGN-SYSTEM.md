# CityWalk AI 设计系统

> **版本** v1.0 ｜ **日期** 2026-10-26 ｜ **状态** 现状记录 + 必要调整建议
> **适用范围**：`index.html`、`css/style.css`、`js/pages/*.js`、`js/map.js` 所呈现的全部界面
> **事实来源**：`css/style.css`（604 行）、`index.html`（57 行）、`js/ui.js`、`js/pages/home.js`、`js/pages/discover.js`、`js/pages/favorites.js`、`js/map.js`、`js/data.js`
> **机器可读版本**：`docs/design/tokens.json`
>
> **阅读约定**：`--var` 指 CSS 变量；`.class` 指 CSS 类名；`L123` 指 `css/style.css` 第 123 行；`home.js:456` 指 `js/pages/home.js` 第 456 行。本文件所有描述都可以在源码中逐条核对，**没有凭空发明的组件**；现有产品中不存在的，统一标注「当前缺失，建议新增」。

---

## 〇、一页概览

**一句话**：墨绿（forest）+ 米白（cream）+ 暖橙（amber）的城市生活方式杂志气质——用纸面底色、克制的圆角与阴影、三处衬线标题，把「AI 规划工具」做得像一本城市漫游手册，而不是一个后台管理系统。

**五条可核对的视觉原则**（不是空泛口号，每条都能在代码里验证）：

1. **纸面优先**：页面底色是 `--cream`（L59），卡片是 `--white`（L174），边框一律 1px `--line`。深色填充只留给「确定的结论」——`.summary-card`（L324）、`.toast`（L575）、`.btn-primary`（L186）、`.nav-item.on`（L108）。深色是**结论**，不是装饰。
2. **双色分工**：`--forest` 表示确定与主操作；`--amber` 是唯一暖色，只用于「行动 / 提醒 / 注意」（`.btn-amber` L189、`.dot-live` L304、地图终点 L403、`.place-card.drop-target` L431）。两者不互换，也不互相替代。
3. **静默阴影**：`.card` 用 `--sh-1`（L174），悬停升到 `--sh-2`，只有浮层（菜单 / 弹窗 / Toast）用 `--sh-3`（L123/L152/L560/L576）。全文件 29 处 `box-shadow` 声明中，这三个 token 撑起了主要层级。
4. **衬线只给三处**：`.brand-text b`（L98）、`.summary-card h2`（L330）、`.rc-body h3`（L528）。衬线是「点睛」，正文、按钮、表格一律无衬线。
5. **圆角克制**：卡片 `--r-lg` 16px、二级卡片 `--r-md` 12px、控件 `--r-sm` 9px、胶囊 `--r-pill` 999px（L42–45）。没有第 5 级。

**现有设计语言的 token 盘点**（统计自 `css/style.css`）：

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| `:root` 变量总数 | **39** | 色彩 22 + 类别色 8 + 圆角 4 + 阴影 3 + 字体栈 2 |
| 唯一色值（`:root` 内） | **29** | 30 处 hex 声明，其中 1 个重复 |
| 类别色变量 | 8 | `--c-street` … `--c-photo`，**定义了但 0 处 `var()` 引用**（见 P2-1） |
| 硬编码色值（`:root` 外） | **21 个唯一值 / 34 处** | 见 1.5 节 |
| 字号档位 | **19 档**（102 处声明） | 见 2.2 节 |
| 行高 / 字重 | 10 种 / 5 种 | 见 2.3、2.4 节 |
| 间距 token | **0 个** | padding/margin/gap 里出现 33 种 px 值、234 处（见 3.1） |
| 阴影值 | 3 个 token + 14 种硬编码写法 | 29 处 `box-shadow` 声明，17 种不同值 |
| 断点 | **1 个**（`max-width:1280px`，L600） | 见 7.4 |

---

## 一、色彩

### 1.1 色板变量（22 个，含 `--white`）

| 变量 | 色值 | 语义 | 主要用处（类名 @ 行号） |
| --- | --- | --- | --- |
| `--forest` | `#1F3D2B` | 品牌主色 / 主操作 / 结论 | `.brand-mark` L93、`.btn-primary` L186、`.nav-item.on` L108、`.pill.on` L207、`.summary-card` L324、`.route-path` L406、`.tl-num` 边框 L416 |
| `--forest-2` | `#2C5B41` | 主色悬停 / 链接文字 | `.btn-primary:hover` L187、`.link-btn` L275、`.diff-row .to` L482、`.tag-green` 文字 L214 |
| `--forest-3` | `#3E7A58` | 交互描边（聚焦 / 悬停边） | `.input:focus` 边框 L225、`.city-btn:hover` L118、`.pill:hover` L206、`.pc-reason` 左边线 L438 |
| `--forest-soft` | `#EAF0EA` | 主色浅底 / 聚焦光晕 | 聚焦 `box-shadow` L225、`.tag-green` 底 L214、`.chat-avatar` L458、`.help-item .hi-n` L587、`::selection` L72 |
| `--forest-line` | `#D5E1D6` | 卡片悬停描边 | `.place-card:hover` L428、`.route-card:hover` L522、`.place-mini:hover` L316 |
| `--cream` | `#FBF8F2` | 纸面底色（页面 / 输入区） | `body` L59、`.prompt-box textarea` L268、`.adv-toggle` L284、`.pc-reason` L438 |
| `--cream-2` | `#F4EFE4` | 浅底（次级块 / 标签） | `.nav-item:hover` L107、`.btn-soft` L193、`.tag` L213、`.empty-ico` L246、`.note-box` L235 |
| `--cream-3` | `#EDE7D9` | 浅底悬停加深 | `.btn-soft:hover` L194 |
| `--white` | `#FFFFFF` | 卡片 / 浮层 / 输入框 | `.card` L174、`.modal` L560、`.input` L222、`.city-btn` L116 |
| `--line` | `#E5DFD2` | 常规边框 | `.card` L174、`.input` L222、`.btn-ghost` L191、`.seg` L296、`.city-btn` L116 |
| `--line-2` | `#EFEAE0` | 分隔线 / 内部细线 | `.divider` L231、卡片内分区 L355、L457、`.chat-input` L490 |
| `--ink` | `#1E2A22` | 正文 / 标题 | `body` L60、`.toast` 底 L575、`.lstep.doing` L505 |
| `--ink-2` | `#5A645C` | 次要文字 | `.page-head p` L171、`.btn-ghost` 文字 L191、`.pc-meta` L439、`.modal-head p` L566 |
| `--ink-3` | `#8D968E` | 辅助文字（元信息） | `.hint` L232、`.card-title .sub` L178、`.rc-meta` L530、`.kv span` L592、`.map-note` L390、`.empty` L244 |
| `--ink-4` | `#AEB6AF` | 弱化文字 / 占位 | `.input::placeholder` L227、`.prompt-count` L274、`.lstep` 待办 L502、`.fav-btn` L446、`.diff-row .from` L481 |
| `--amber` | `#D9822B` | 行动 / 提醒（唯一暖色） | `.btn-amber` L189、`.btn-amber-on-dark` L342、`.dot-live` L304、`.route-path-dash` L407 |
| `--amber-2` | `#B96A19` | 暖橙文字 | `.tag-amber` L215、`.cond-row .v.miss` L351、`.msg.me .av` L468、`.pill-amber` 文字 L208 |
| `--amber-soft` | `#FDF2E3` | 暖橙浅底 | `.pill-amber` L208、`.note-box.amber` L238、`.hero-card h1 em::after` L262、`.place-card.drop-target` L431 |
| `--blue` | `#3E6E8E` | 信息蓝（提示） | `.tag-blue` L216（当前未被业务使用） |
| `--blue-soft` | `#EAF1F6` | 信息浅底 | `.note-box.blue` L240、`.tag-blue` L216 |
| `--rose` | `#B4574F` | 风险红 / 收藏 | `.fav-btn:hover/.on` L447–448、`.tag-rose` L217 |
| `--rose-soft` | `#FBEDEB` | 风险浅底 | `.note-box.rose` L239、`.tag-rose` L217 |

**用色规则（写需求时必须遵守）：**

- 主操作按钮只用 `--forest`；`--amber` 用在「有明确下一步动作」的位置（一键体验、收藏），不用在导航与标题。
- 一个区块内最多出现一种语义色。琥珀提示条（`.note-box.amber`）与蓝色提示条（`.note-box.blue`）不要在同一个卡片里堆叠——现有实现里摘要卡下方最多同时出现 3 条提示（`home.js:585–596`），已经接近拥挤。
- 深色底上不再叠加 `--amber-soft` 等浅色块；深色只在 `.summary-card`、`.toast`、`.btn-primary`、`.nav-item.on` 四处出现。

### 1.2 类别色（8 个，当前**未接入 CSS**）

| 变量 | 色值 | 类别 | 实际使用来源 |
| --- | --- | --- | --- |
| `--c-street` | `#7A8B7F` | 街区漫步 | `js/data.js` `CATEGORIES.street.color` |
| `--c-cafe` | `#B4744A` | 咖啡馆 | `js/data.js` `CATEGORIES.cafe.color` |
| `--c-book` | `#4E7A8A` | 独立书店 | `js/data.js` `CATEGORIES.book.color` |
| `--c-history` | `#8A6A4B` | 历史街区 | `js/data.js` `CATEGORIES.history.color` |
| `--c-park` | `#4F8A5C` | 公园绿地 | `js/data.js` `CATEGORIES.park.color` |
| `--c-arch` | `#6B6E9A` | 建筑街区 | `js/data.js` `CATEGORIES.arch.color` |
| `--c-food` | `#B4574F` | 本地特色 | `js/data.js` `CATEGORIES.food.color` |
| `--c-photo` | `#8A7BA8` | 摄影点位 | `js/data.js` `CATEGORIES.photo.color` |

**重要事实**：这 8 个变量在 `css/style.css` 里**没有任何 `var(--c-*)` 引用**；界面上的类别色全部来自 `js/data.js` 第 33–40 行的同名色值（内联到 `style` 属性里，例如 `home.js:718` 的 `.pc-cat` 与 `map.js:158` 的标记填充）。也就是说：**同一套类别色存了两份，改一处不会同步另一处**。这属于必要调整（P2-1），不是风格问题。

### 1.3 对比度检查（WCAG 2.1 AA）

判定标准：普通文本 ≥ **4.5:1**；大文本（≥18.66px 粗体 或 ≥24px）≥ 3:1；非文本（输入框边界、图标、状态指示）≥ 3:1（SC 1.4.11）。下面的比值均按 WCAG 相对亮度公式实算，不是估计。

**通过的组合（可继续使用）：**

| 前景 / 背景 | 比值 | 用途 |
| --- | --- | --- |
| `--ink` / `--cream` | 14.06 | 正文 |
| `--ink-2` / `--cream` | 5.81 | 说明文字 |
| `--ink-2` / `--white` | 6.15 | 卡片内说明 |
| `#FFFFFF` / `--forest` | 11.93 | 主按钮、导航选中 |
| `#FFFFFF` / `--forest-2` | 7.84 | 主按钮悬停 |
| `#FFFFFF` / `--ink` | 14.90 | Toast |
| `--forest-2` / `--forest-soft` | 6.77 | `.tag-green` |
| `#335B76` / `--blue-soft` | 6.35 | `.note-box.blue` |
| `#8E423B` / `--rose-soft` | 6.15 | `.note-box.rose` |
| `#8A5A15` / `--amber-soft` | 5.34 | `.note-box.amber` |
| `#FFFFFF` / `#8A5A15` | 5.91 | `.toast.warn` |
| `#FFFFFF` / `#8E423B` | 7.02 | `.toast.err` |
| `rgba(255,255,255,.60)` / `--forest` | 5.38 | `.sc-eyebrow` 11px |
| `rgba(255,255,255,.62)` / `--forest` | 5.64 | `.sc-metrics .m span` 11.5px |
| `#4A544C` / `#F7F5EE` | 7.23 | 地图地名 `.mk-label` |

**不通过的组合（列表即 P0/P1 依据）：**

| 前景 / 背景 | 比值 | 要求 | 出现位置 | 结论 |
| --- | --- | --- | --- | --- |
| `--ink-3` / `--cream` | **2.88** | 4.5 | `.hint`（位于 `.pc-reason` 的米色底上）、`.brand-text i` | 不通过 |
| `--ink-3` / `--white` | **3.05** | 4.5 | `.card-title .sub`、`.rc-meta`、`.kv span`、`.empty p` | 不通过 |
| `--ink-3` / `#FDFCF9` | **2.97** | 4.5 | `.map-note`（暖白底 #FDFCF9） | 不通过 |
| `--ink-4` / `--cream` | **1.96** | 4.5 | `.prompt-count`、`.lstep` 待办、`.diff-row .from` | 严重不通过 |
| `--ink-4` / `--white` | **2.08** | 4.5 | 输入框占位符 `.input::placeholder` | 严重不通过 |
| `#FFFFFF` / `--amber`（`.btn-amber`） | **2.93** | 4.5 | 「一键体验」按钮（`home.js:506`） | 不通过，主操作文字不可读 |
| `#FFFFFF` / `--amber`（`.btn-amber-on-dark`） | **2.93** | 4.5 | 摘要卡「收藏路线」按钮（`home.js:579`） | 不通过 |
| `--amber-2` / `--amber-soft` | **3.69** | 4.5 | `.tag-amber`（`.tag` 11.5px） | 不通过 |
| `--amber-2` / `--white` | **4.09** | 4.5 | `.cond-row .v.miss`「未指定」 | 不通过（临界） |
| `--rose` / `--rose-soft` | **4.17** | 4.5 | `.tag-rose`（当前未使用） | 不通过（临界） |
| `#FFFFFF` / `#B9C2BB` | **1.83** | — | `.btn-primary:disabled` L188 | 禁用态，WCAG 豁免；可读性仍差（P2-9） |
| `--line` / `--white` | **1.33** | 3.0（非文本） | 输入框、卡片边框 | 不通过 1.4.11（P1-4） |
| 焦点光晕 `--forest-soft` / `--white` | **1.16** | 3.0（非文本） | `.input:focus` 的 `box-shadow` L225 | 光晕本身不达标，但边框同时变为 `--forest-3`（5.09），可用 |

**类别色作为白字标记底（12px 粗体白字，要求 4.5）：**

| 类别 | 色值 | 白字对比度 | 结论 |
| --- | --- | --- | --- |
| 独立书店 | `#4E7A8A` | 4.69 | 通过 |
| 历史街区 | `#8A6A4B` | 4.95 | 通过 |
| 建筑街区 | `#6B6E9A` | 4.86 | 通过 |
| 本地特色 | `#B4574F` | 4.75 | 通过 |
| 街区漫步 | `#7A8B7F` | **3.60** | 不通过 |
| 咖啡馆 | `#B4744A` | **3.79** | 不通过 |
| 公园绿地 | `#4F8A5C` | **4.10** | 不通过 |
| 摄影点位 | `#8A7BA8` | **3.83** | 不通过 |

**类别色作为文字放在自身 10% 淡底上（`.pc-cat`，`home.js:718` 的 `color + '1A'`）：** 8 个全部不通过（3.23–4.36）。同一位置改用 `--ink-2` 后为 5.39–5.52，通过。

### 1.4 补充说明

- 地图底图（`map.js` 第 19–67 行）自成一套水色 / 绿地 / 城墙色（`#DCE9EF`、`#D2E2EA`、`#E4EDE0`、`#D6C8B0` 等），与 UI 色板分开维护。它们不承载文字信息，本轮不改；若后续要统一，先改 `map.js` 的 `BASE` 常量，不要在 `style.css` 里覆盖 SVG 属性。
- 图片上的浮层文字（`.pm-cat` L321、`.rc-badge` L526、`.pc-order` L433、`.dh-cat` L597）依赖底图亮度，**无法给出固定对比度**。现有做法是加 92–95% 不透明度的白色或 85–86% 的墨绿底，属于可接受的兜底；新增同类组件时照此办理，不要直接白字压图。

### 1.5 硬编码色值清单（21 个唯一值 / 34 处，`:root` 之外）

| 色值 | 位置 | 建议 |
| --- | --- | --- |
| `#F7F5EE` | 地图底 `L359`、`map.js` 底图 | 可提为 `--map-bg`（P2-2） |
| `#FDFCF9` | `.chat-body` L463、`.chat-chips` L484、`.modal-foot` L568、`.map-note` L390 | 可提为 `--surface-warm`（P2-2） |
| `#EFEDE5` | `.real-map` L363 | 真实地图占位底 |
| `#B9C2BB` | `.btn-primary:disabled` L188 | 建议提为 `--forest-disabled` |
| `#8A5A15` / `#8E423B` / `#335B76` | `.note-box.amber/.rose/.blue` L238–240 | 建议提为 `--amber-ink` / `--rose-ink` / `--blue-ink` |
| `#F0D6B4` / `#F1DCC0` / `#F2D8D5` / `#D8E5EE` | 胶囊与提示条描边 L208、L238–240 | 建议各配一个 `-line` 变体 |
| `#E08F3C` | `.btn-amber-on-dark:hover` L343 | 建议并入 `--amber` 家族 |
| `#8FD3A8` | `.toast.ok svg` L579 | 图标色，非文字，可保留 |
| `#C4BDAC` / `#D8D2C4` | 滚动条 L76–77 | 浏览器私有样式，可保留 |
| `#EFEAE0` / `#F7F4EC` | `.skel` 渐变 L251 | `.skel` 当前未被使用（P2-7） |
| `#1F3D2B` / `#D9822B` | 地图标记描边 L402–403、`map.js` | 与 `--forest`、`--amber` 同值，可直接换变量 |
| `#4A544C` | `.mk-label` L400 | 地图地名专用，建议提为 `--map-label` |

> 结论：**21 个硬编码色值中有 15 个其实是缺少命名的 token**，其中 6 个（`--amber-ink` 一组、`--forest-disabled`）是本轮修对比度时必须新增的。其余 6 个属于浏览器私有样式或图片浮层兜底，保持原样。

---

## 二、字体

### 2.1 字体栈（2 个）

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--sans` | `"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",system-ui,-apple-system,sans-serif` | 全局正文（`body` L58）、地图标记 L367/L397 |
| `--serif` | `Georgia,"Songti SC","Source Han Serif SC",serif` | 仅 3 处：`.brand-text b` L98、`.summary-card h2` L330、`.rc-body h3` L528 |

**规则**：新增任何标题前先判断它是不是「杂志式点睛」。是，才用 `--serif`；否则一律 `--sans`。把衬线用到导航、按钮、表单标签上，会立刻变成「文艺模板风」，与本产品「工具感 + 纸感」的平衡相悖。

### 2.2 字号阶梯（19 档 / 102 处声明）

| 字号 | 角色 | 代表位置 |
| --- | --- | --- |
| 27px | 首页主标题 | `.hero-card h1` L260 |
| 25px | 页面标题 | `.page-head h1` L170 |
| 23px | 结果主标题（衬线） | `.summary-card h2` L330 |
| 18px | 区块标题 | `.section-title h2` L550 |
| 17.5px | 路线卡标题（衬线） | `.rc-body h3` L528 |
| 17px | 弹窗标题、摘要数字 | `.modal-head h3` L565、`.sc-metrics .m b` L335 |
| 16px | 品牌名（衬线）、加载标题 | `.brand-text b` L98、`.loading-wrap h3` L499 |
| 15.5px | 卡片标题 | `.card-title h3` L177、`.preview-head h3` L310 |
| 15px | 地点卡标题 | `.pc-top h4` L436 |
| 14.5px | 空状态标题、大按钮 | `.empty h4` L248、`.btn-lg` L196 |
| 14px | **正文基准** | `body` L61 |
| 13.5px | 按钮、说明段落 | `.btn` L182、`.page-head p` L171、`.hero-card .sub` L263 |
| 13px | 步骤、Toast、条件行 | `.lstep` L502、`.toast` L576、`.cond-row` L347 |
| 12.5px | 小按钮、气泡、表单标签 | `.btn-sm` L195、`.bubble` L470、`.kv` L590、`.rc-desc` L529、`.field label` L220 |
| 12px | 元信息 | `.hint` L232、`.card-title .sub` L178、`.pc-meta` L439 |
| 11.5px | 徽标、脚注、对话胶囊 | `.tag` L213、`.map-note` L390、`.chat-chips button` L487、`.prompt-count` L274 |
| 11px | 大写小标、图例、对比块标题 | `.sc-eyebrow` L329、`.map-legend .lg-row` L388、`.diff-box .d-h` L479、`.rc-badge` L526 |
| 10.5px | 品牌副标题、地图地名 | `.brand-text i` L100、`.mk-label` L400、`.pm-cat` L321 |
| 10px | 地图起终点标签 | `.mk-tag` L401 |

**现状评价**：19 档里 10.5 / 11.5 / 12.5 / 13.5 与 12 / 13 / 14 在视觉上差异极小（0.5px），却各自承担了不同角色。这是后续最容易产生「随手加一档 12.5px」的地方。**建议**（P2-3，不强制本轮改）：收敛为 8 档 `10 / 11 / 12 / 13 / 14 / 16 / 23 / 27`，把 0.5px 档并入相邻档；改动时按「同角色同档」合并，不做整站重排。

### 2.3 行高（10 种 / 19 处声明）

| 行高 | 场景 |
| --- | --- |
| `1.65` | 全局正文 `body` L62 |
| `1.7` | 对话气泡 L470、`.textarea` L226、`.note-box` L234、`.help-item` L589 |
| `1.75` | 大输入框 L267、详情正文（`discover.js:120` 内联） |
| `1.6` | `.hint` L232、`.note-box` L234 |
| `1.5` | `.city-menu .cm-note` L134、`.pm-body span` L320 |
| `1.4` | `.empty` 标题 L248、`.pm-body b` L319 |
| `1.35` | 路线卡标题 L528 |
| `1.32` | 首页主标题 L260 |
| `1.25` | `.chat-head .ch-t` L460 |
| `1.15` | `.brand-text` L97 |

**规则**：正文与段落用 1.65–1.75；单行标题用 1.25–1.4；不要给按钮、标签设置 `line-height`（继承即可，避免高度抖动）。

### 2.4 字重（5 种）

`400`（默认正文）、`500`（`.sc-metrics small` L336）、`600`（按钮、导航选中、表单标签、`.pill.on`）、`700`（标题、数字、徽标）、`800`（`.mk-tag` 地图起终点标签 L401）。

**规则**：中文只有 3 档可用视觉区分（400 / 600 / 700），`500` 与 `800` 在中文字体下几乎无法与相邻档区分。新增文案优先用 400 / 600 / 700，`500`/`800` 仅限已有的两处。

### 2.5 排版细则

- 标题字距：`h1–h4` 统一 `letter-spacing:-.01em`（L68），大标题额外 `-.02em`（L170、L260、L335）。
- 小幅大写间距：`.sc-eyebrow` `letter-spacing:.14em`（L329）、`.brand-text i` `.04em`（L100）、`.diff-box .d-h` `.04em`（L479）。仅用于英文小标与眉标，不用于中文。
- 中文标点与数字：界面使用全角标点，数字与单位之间留空格（`4 小时 20 分`、`¥65–210`、`3.1 km`），由 `fmtDuration` / `fmtCost`（`ui.js:115–128`）统一输出，**不要在页面里手拼时长与价格**。

---

## 三、间距、圆角、边框、阴影

### 3.1 间距

**现状：没有任何间距 token。** 全文件 `padding` / `margin` / `gap` 共 234 处、33 种不同 px 值：
`1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 26, 27, 28, 30, 32, 36, 40, 44, 52, 80`。

主节奏其实是 4 的倍数（4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 52 / 80），9–11 与 13–15 多为视觉微调。

**页面级间距（写新页面前先对齐这张表）：**

| 位置 | 数值 | 出处 |
| --- | --- | --- |
| 顶栏内容宽度 / 左右留白 | `max-width:1440px`，`padding:0 28px`，高 64px | `.topbar-inner` L87–90 |
| 页面容器 | `max-width:1440px`，`padding:26px 28px 80px` | `.view` L168 |
| 左右两栏比例 / 间距 | `42fr : 58fr`，`gap:26px` | `.workspace` L255 |
| 同栏内卡片纵向间距 | `gap:18px` | `.ws-left` / `.ws-right` L256–257 |
| 标准卡片内边距 | `20px 22px` | `.card-pad` L175 |
| 首屏 hero 卡内边距 | `26px 24px 22px` | `.hero-card` L259 |
| 地点卡内边距 | `13px 15px 14px` | `.pc-body` L434 |
| 路线卡网格间距 | `gap:20px` | `.route-grid` L517 |
| 地点发现网格间距 | `gap:14px` | `.discover-grid` L314 |
| 收藏列表网格间距 | `gap:12px` | `.grid-2` L547 |
| 弹窗遮罩留白 | `padding:40px` | `.modal-mask` L556 |
| 页面底部留白 | `80px` | `.view` L168 |

**建议（P2-4，不强制本轮改）**：新增 7 个间距 token（`--space-1:4px`、`-2:8`、`-3:12`、`-4:16`、`-5:20`、`-6:28`、`-7:40`）。理由是：再没有约束，下一次改版会出现第 34、35 种 px 值；但本轮不动现有数值，避免整站重排引发视觉回归。

### 3.2 圆角

| 变量 / 值 | 声明数 | 用于 |
| --- | --- | --- |
| `--r-lg` 16px | 8 | `.card`、`.hero-card`、`.preview-card`、`.map-card`、`.modal`、`.route-card`、`.filter-bar`、`.summary-card` |
| `--r-md` 12px | 12 | `.btn`、`.city-menu`、`.avatar-menu`、`.bubble`、`.saved-route`、`.saved-place`、`.detail-hero`、`.place-card`、`.place-mini`、`.map-legend`、`.adv-toggle`、`.prompt-box textarea` |
| `--r-sm` 9px | 12 | `.input/.textarea/.select`、`.btn-sm`、`.note-box`、`.seg`、`.pc-reason`、`.map-ctrl button`、`.city-menu .cm-item`、`.chat-input input`、`.avatar-menu button` |
| `--r-pill` 999px | 14 | `.pill`、`.tag`、`.nav-item`、`.city-btn`、`.toast`、`.map-layers`、`.rc-dur`、`.rc-badge`、`.pc-order`、`.dh-cat`、`.pm-cat` |
| `50%` | 14 | 头像、圆点、`.tl-num`、`.empty-ico`、`.chat-avatar`、`.msg .av` |
| `10px` | 1 | `.brand-mark` L93（品牌方块，唯一的特例） |
| `9px` | 1 | 滚动条 L76 |
| `6px` | 2 | `.sort-btn` L450、`.skel` L251 |
| `3px` | 1 | `.hero-card h1 em::after` 高亮条 L262 |

**规则**：卡片 16、二级卡片 12、控件 9、胶囊 999。除品牌方块外，不再新增圆角值。`.sort-btn` 的 6px 与 9px 体系不一致，可顺手并入 `--r-sm`（P2-5）。

### 3.3 边框

| 写法 | 语义 | 出现位置 |
| --- | --- | --- |
| `1px solid var(--line)` | 容器边界（卡片、输入、次级按钮、菜单、弹窗） | L174、L191、L222、L296、L560 等 |
| `1px solid var(--line-2)` | 卡片内部分区线 | L355、L457、L564、L568、L490 |
| `1px dashed var(--line)` | 「可展开 / 可添加」的容器 | `.adv-toggle` L283 |
| `1px dashed var(--line-2)` | 行级分隔（不是容器） | `.cond-row` L347、`.pc-foot` L442、`.rc-meta` L530、`.kv` L590、`.diff-box` L478 |
| `2px solid var(--forest)` | 时间轴序号圈 | `.tl-num` L416 |
| `2.5px`（SVG stroke） | 地图标记描边 | `.mk .mk-body` L396 |
| `2px`（SVG stroke） | 真实地图标记描边（适配器） | `.real-map .cw-marker span` L366 |
| `border-left:2px solid var(--forest-3)` | 引述块（推荐理由） | `.pc-reason` L438 |

**规则**：实线＝容器边界；虚线＝可展开的容器或行级分隔。不要用虚线画卡片边框（`.place-card.dragging` 例外，那是拖拽中的临时态）。

### 3.4 阴影

| 变量 | 值 | 层级 | 使用 |
| --- | --- | --- | --- |
| `--sh-1` | `0 1px 2px rgba(31,61,43,.05)` | 静置 | `.card`、`.preview-card`、`.filter-bar`、`.map-ctrl`、`.map-layers`、`.route-card` |
| `--sh-2` | `0 2px 6px rgba(31,61,43,.05), 0 10px 26px rgba(31,61,43,.055)` | 悬停 / 强调卡 | `.hero-card`、`.summary-card`、`.place-mini:hover`、`.place-card:hover`、`.place-card.sel` |
| `--sh-3` | `0 6px 16px rgba(31,61,43,.08), 0 24px 48px rgba(31,61,43,.10)` | 浮层 | `.city-menu`、`.avatar-menu`、`.modal`、`.toast`、`.route-card:hover` |

**现状**：29 处 `box-shadow` 声明、17 种不同值。除三个 token 外，其余 14 种是单点写法：主按钮悬停 `0 4px 14px rgba(31,61,43,.22)`（L187）、聚焦光晕 `0 0 0 3px var(--forest-soft)`（L225、L429、L492）、头像描边 `0 0 0 1px var(--line)`（L147）、真实地图标记 `0 1px 4px rgba(0,0,0,.28)`（L367）。

**规则**：只有三级。悬停最多升一级；不要为「强调」再发明第四级。暖阴影一律用 `rgba(31,61,43,...)`（墨绿投影），不用纯黑——现有实现已经这样做了，保持。

### 3.5 动效与过渡

| 时长 | 用途 |
| --- | --- |
| `.15s / .16s / .18s` | 按钮、胶囊、卡片悬停（`.btn` L183、`.nav-item` L105、`.route-card` L520） |
| `.2s / .22s / .25s / .28s` | 弹窗 rise、Toast 进入、加载步骤状态、筛选面板展开（L563、L576、L502、L291） |
| `@keyframes` | `pop` L165（菜单）、`fade` L558（遮罩）、`rise` L563（弹窗）、`toastIn` L582、`blink` L305（AI 状态点）、`dash` L408（路线虚线流动）、`spin` L498（加载环）、`sk` L252（骨架，未使用） |

**现状问题**：没有 `prefers-reduced-motion` 降级。`.dot-live`（无限闪烁）、`.route-path-dash`（26 秒循环）、`.loading-ring`（旋转）都是自动且持续的运动，会触发前庭敏感（见 P1-6）。

---

## 四、组件清单与状态

**总览**：以下全部组件都已存在，并非规划。每条给出类名、状态与出处；状态里「无」表示该状态当前没有样式定义，属于差距（第 8 节汇总）。

### 4.1 按钮

| 变体 | 类名 | 状态 | 出处 |
| --- | --- | --- | --- |
| 主按钮 | `.btn.btn-primary` | 默认 / hover（`--forest-2` + 投影）/ disabled（`#B9C2BB`，`cursor:not-allowed`）/ **无 :active、无 :focus-visible** | L180–188 |
| 暖橙按钮 | `.btn.btn-amber` | 默认 / hover（`--amber-2`） | L189–190 |
| 次级按钮 | `.btn.btn-ghost` | 默认（白底 `--line` 边）/ hover（`--forest-3` 边 + `--forest` 文字 + `--forest-soft` 底） | L191–192 |
| 柔和按钮 | `.btn.btn-soft` | 默认（`--cream-2`）/ hover（`--cream-3`） | L193–194 |
| 深色底上的按钮 | `.btn-on-dark` / `.btn-amber-on-dark` | 默认 / hover（白 22% / `#E08F3C`） | L340–343 |
| 尺寸 | `.btn-sm`（7/12，12.5px）/ `.btn-lg`（13/22，14.5px，宽度 100%）/ `.btn-block` | — | L195–197 |
| 纯图标按钮 | `.btn-icon`（32×32）/ `.icon-btn`（34 圆形）/ `.close-x`（30 圆形）/ `.fav-btn`（28）/ `.sort-btn`（26，含 disabled） | hover / disabled（仅 `.sort-btn`）/ 选中（`.fav-btn.on`） | L198–200、L136–141、L569–571、L446–453 |
| 文字按钮 | `.link-btn` | 默认（`--forest-2`）/ hover（下划线 + `--forest`）/ 图标间距 5px | L275–277 |
| 地图控件 | `.map-ctrl button` / `.map-layers button` | 默认 / hover / `.on`（图层开启） | L371–383 |

**按钮用词**（详见 `04-文案规范.md` 第二节）：主操作「生成我的 CityWalk 路线」、已生成「按当前条件重新生成」、生成中「正在为你规划…」+ 禁用。

### 4.2 胶囊与标签

| 组件 | 类名 | 状态 | 出处 |
| --- | --- | --- | --- |
| 可点胶囊 | `.pill` | 默认 / hover（`--forest-3` 边 + `--forest` 文字）/ `.on`（`--forest` 底白字加粗）/ `.pill-static`（禁止悬停反馈） | L202–211 |
| 暖橙胶囊 | `.pill.pill-amber` | 静态，用于对话里的冲突选项 | L208 |
| 柔和胶囊 | `.pill.pill-soft` | 静态 | L209 |
| 标签 | `.tag` | 默认（`--cream-2`）/ `.tag-green` / `.tag-amber` / `.tag-blue` / `.tag-rose` | L213–217 |

**注**：`.tag-blue` 与 `.tag-rose` 已定义但当前没有任何代码使用；`.tag-green` 用于地图头的距离标签（`home.js:549`），`.tag-amber` 用于精选路线预算（`home.js:503`）。

### 4.3 表单

| 组件 | 类名 | 状态 | 出处 |
| --- | --- | --- | --- |
| 字段容器 | `.field` + `label` | 标签 12.5px / 600 / `--ink-2` | L219–220 |
| 输入框 | `.input` | 默认（白底 `--line` 1px）/ focus（`--forest-3` 边 + 3px `--forest-soft` 光晕，`outline:none`）/ 占位符 `--ink-4` / **无 disabled、无 invalid、无 readonly 样式** | L221–227 |
| 文本域 | `.textarea` | 同上 + `resize:vertical`、`min-height:104px` | L221–226 |
| 下拉 | `.select` | `appearance:none` + 内联 SVG 箭头（`stroke='%238D968E'`） | L228 |
| 分段控件 | `.seg` + `button` | 默认 / hover（`--cream-2`）/ `.on`（`--forest` 白字） | L296–300 |
| 多选胶囊组 | `.chips` + `.pill` | 同 4.2 | L230 |
| 大输入区 | `.prompt-box textarea` + `.prompt-foot` + `.prompt-count` | 默认 `--cream` 底 / focus 白底 / 计数 `--ink-4` | L265–277 |
| 折叠面板 | `.adv-toggle` + `.adv-panel` | 关闭（`max-height:0`）/ 打开（`max-height:760px`）/ `.caret` 旋转 180° | L281–293 |

**当前缺失，建议新增**：`invalid` 态（红边 + 错误文案槽）。现有校验全部走「对话追问」或 Toast，表单项本身不报错——这在「预算填了非数字」这类场景下没有就地反馈（见 P1-5）。

### 4.4 卡片与容器

| 组件 | 类名 | 状态 | 出处 |
| --- | --- | --- | --- |
| 标准卡片 | `.card` + `.card-pad` + `.card-title`（`h3` + `.sub`） | 静置 | L174–178 |
| 首屏 hero | `.hero-card`（含 `h1 em` 高亮条） | 静置（`--sh-2`） | L259–263 |
| 预览卡 | `.preview-card` + `.preview-head` + `.preview-body` | 静置 | L308–312 |
| 路线摘要卡 | `.summary-card`（深色）+ `.sc-eyebrow` / `h2` / `.sc-style` / `.sc-metrics` / `.sc-actions` | 按来源切换眉标文案（精选 / AI 模拟） | L324–343 |
| 地图卡 | `.map-card` + `.map-head` + `.map-stage` + `.map-note` | 缩放 / 拖拽中（`.map-stage.dragging`） | L354–391 |
| 对话卡 | `.chat-card` + `.chat-head` + `.chat-body` + `.chat-chips` + `.chat-input` | 消息 / 输入 | L456–492 |
| 路线卡 | `.route-card` + `.rc-img` / `.rc-body` / `.rc-meta` / `.rc-acts` | 默认 / hover（上移 3px + `--sh-3`） | L518–534 |
| 地点卡 | `.place-card`（网格 `132px 1fr`） | 默认 / hover / `.sel` / `.dragging` / `.drop-target` | L424–453 |
| 地点小卡 | `.place-mini` | 默认 / hover（上移 2px） | L315–321 |
| 收藏行 | `.saved-route` / `.saved-place` | 默认 / hover（仅 `.saved-route`） | L536–546 |
| 提示条 | `.note-box`（默认 / `.amber` / `.rose` / `.blue`） | 静态 | L233–240 |
| 键值行 | `.kv` | 静态（虚线分隔） | L590–593 |
| 帮助列表 | `.help-list` / `.help-item` / `.hi-n` | 静态 | L585–589 |

### 4.5 弹窗

- 实现：`CW.ui.modal(opts)`（`ui.js` 第 91–112 行）。结构 `.modal-mask > .modal > .modal-head（h3 + p.sub + .close-x）/ .modal-body / .modal-foot`。
- 状态：打开（遮罩 `fade` 180ms、面板 `rise` 200ms）/ 关闭。
- 关闭方式：`Esc`（`ui.js:106`）、点遮罩、点 `[data-mclose]`。
- 宽度：`opts.width` 默认 620，实际用到 520（个人中心）、620（移除确认）、640（地点详情）、680（路线详情）。
- 底部操作：`footer:false` 可隐藏；默认是「关闭」。
- **当前缺失，建议新增**：`role="dialog"`、`aria-modal="true"`、`aria-labelledby`、打开时焦点移入、关闭后焦点归还、Tab 焦点循环（P0-4）。

### 4.6 顶部导航

| 组件 | 类名 | 状态 | 出处 |
| --- | --- | --- | --- |
| 顶栏 | `.topbar`（sticky，`backdrop-filter`）/ `.topbar-inner` | 常驻 | L81–90 |
| 品牌 | `.brand` / `.brand-mark` / `.brand-text b em` | 静置 | L91–100 |
| 主引导 | `.mainnav` / `.nav-item` | 默认 / hover / `.on`（墨绿底白字） | L102–108 |
| 城市选择 | `.city-picker` / `.city-btn` / `.city-menu`（`.open`）/ `.cm-item` / `.cm-note` | 关闭 / 打开（`pop` 动画）/ 选中项 `.on` | L113–134 |
| 帮助 | `.icon-btn#btnHelp` | 默认 / hover | L136–141 |
| 头像菜单 | `.avatar-wrap` / `.avatar` / `.avatar-menu`（`.open`）/ `.am-head` | 关闭 / 打开 | L143–163 |

**交互补充**：菜单的关闭依赖全局 document 点击（`app.js` 第 124–128 行），`Esc` 不关闭下拉（只有弹窗支持 Esc）。键盘可达性缺口见 P1-7。

### 4.7 Toast

- 实现：`CW.ui.toast(msg, type)`（`ui.js` 第 74–88 行）。`.toast-root` 固定在底部居中（L573），多个 Toast 纵向堆叠。
- 类型：默认/`ok`（`--ink` 底）、`warn`（`#8A5A15` 底）、`err`（`#8E423B` 底）；`ok` 的图标是 `#8FD3A8`。
- 生命周期：固定 2400ms 后淡出（`ui.js:82–87`），**没有手动关闭、没有队列上限、没有 `aria-live`**。
- 文案：见 `04-文案规范.md` 第五节。
- **当前缺失，建议新增**：`role="status"` / `aria-live="polite"`，错误类用 `role="alert"`；同时给错误 Toast 更长的停留时间（例如 4000ms）。

### 4.8 加载

| 组件 | 类名 | 状态 | 出处 |
| --- | --- | --- | --- |
| 加载容器 | `.loading-wrap`（居中，`min-height:380px`） | 生成中 | L495–500 |
| 旋转环 | `.loading-ring`（56×56，`spin` 1.1s） | 持续 | L496–498 |
| 四步进度 | `.loading-steps` / `.lstep` / `.ls-ico` | 待办（`--ink-4` + 空心圈）/ 进行中（`.doing`，`--ink` 加粗 + 旋转边框）/ 完成（`.done`，`--forest` 实心 + 对勾） | L501–508 |
| 骨架屏 | `.skel`（`sk` 渐变扫光） | **已定义，全站未使用** | L251–252 |

四步文案（`home.js:10–15`）：「正在理解你的出行偏好」「正在筛选合适的地点」「正在组织路线顺序」「正在检查时间与路线约束」。每一步停留 420–640ms（`home.js:375`）。

### 4.9 空状态

- 结构：`.empty > .empty-ico（52 圆形 + 图标）+ h4 + p + 操作`（L242–249）。容器通常是 `.card`。
- 实际用例：发现页筛选无结果（`discover.js:100–107`）、收藏页两块空态（`favorites.js:37–53`、`69–76`）。
- 规则：主文案一句话说清「空的是什么」，副文案一句解释「怎么才会有」，底部 1–2 个出口按钮。不允许只有图标和「暂无数据」。

### 4.10 错误状态（分散在 4 个通道，没有统一组件）

| 通道 | 视觉 | 实际文案与位置 |
| --- | --- | --- |
| 对话气泡 | `.bubble .b-title` 加粗标题 | 「规划服务暂时不可用」`home.js:387`；「调整失败」`home.js:448`；「已切换为本地模拟」`home.js:416`、`457` |
| 琥珀提示条 | `.note-box.amber` + `alert` 图标 | 冲突摘要 `home.js:585–588`；收藏失效 `favorites.js:42–43`；地图适配器未就绪 `map.js:273–276` |
| 蓝色提示条 | `.note-box.blue` + `clock`/`info` 图标 | 时间偏紧 `home.js:589`；时间富余 `home.js:590`；顺序已手动调整 `home.js:595–596` |
| Toast（错误） | `.toast.err` | 「这条路线已失效」`favorites.js:116`、`165` |

**当前缺失，建议新增**：错误态里的「重试」按钮。现在只有「重新规划」会重新跑一次完整生成（`home.js:580`），对话里的失败提示只能靠用户自己再打一遍字（P1-2）。

---

## 五、路线专属组件

这是本产品区别于普通表单应用的部分：一条路线在界面上有 **4 种表示**（摘要、地图、时间线、详情弹窗），它们必须始终指向同一份数据 `state.route`。

### 5.1 路线列表（发现页）

| 元素 | 类名 / 数值 | 出处 |
| --- | --- | --- |
| 筛选栏 | `.filter-bar`（白底、`--r-lg`、`--sh-1`、`padding:14px 18px`）；内部 `.filter-group` + `.fg-label`（12px `--ink-3`） | L511–516 |
| 网格 | `.route-grid`：`repeat(3,1fr)`，`gap:20px`；≤1280px 变 2 列 | L517、L602 |
| 卡片 | `.route-card`：`--r-lg`、`--sh-1`、`display:flex; column` | L518–521 |
| 封面 | `.rc-img` 高 172px；左右上角浮层 `.rc-badges`（主题徽标）与 `.rc-dur`（时长） | L523–525 |
| 正文 | `.rc-body`：标题 17.5px 衬线 → 描述 12.5px → 元信息 4 项（城市/地点数/距离/预算）→ 操作 2 个按钮 → 收藏文字按钮 | L527–534 |
| 悬停 | `translateY(-3px)` + `--sh-3` + `--forest-line` 描边 | L522 |
| 收藏态 | **只有文案变化**（「收藏这条路线」↔「已收藏，点击取消」），没有视觉状态 | `discover.js:94–95` |

**数据**：6 条精选路线全部是南京（`data.js` 第 205–254 行），`ready:false` 的城市会落到空态。

**差距**：收藏是列表里的高频动作，但它的状态只写在文案里，扫视时看不出来（P2-11）。

### 5.2 地图区域

| 元素 | 类名 / 规格 | 出处 |
| --- | --- | --- |
| 容器 | `.map-card`（`--r-lg`、`--sh-1`、`overflow:hidden`、`z-index:5`） | L354 |
| 头部 | `.map-head`：左 `.mh-l`（`route` 图标 + 「路线示意图」+ 副标「编号与下方卡片顺序一致」）；右 2 个 `.tag` | L355–358、`home.js:544–551` |
| 图幅 | SVG `viewBox="0 0 1000 640"`，`preserveAspectRatio="xMidYMid meet"` | `map.js:17`、`map.js:80` |
| 底图 | 手绘街区（`#F7F5EE`）+ 街区纹理 + 长江渐变 + 玄武湖 + 秦淮河 + 绿地 + 明城墙虚线 + 主干道 | `map.js:19–67` |
| 图层开关 | `.map-layers`：「街区底图」「步行路线」「兴趣点」，`.on` 表示开启 | L378–383、`map.js:86–90` |
| 缩放控件 | `.map-ctrl` 三个 32×32 按钮：放大 / 缩小 / 回到全览，带 `title` | L371–377、`map.js:91–95` |
| 图例 | `.map-legend`：按路线内出现过的类别生成 `.lg-row`（`.lg-dot` 色点）；节点 >1 时追加「起点 · 终点」双环 `.lg-ring` | L384–391、`map.js:107–122` |
| 脚注 | `.map-note`：`示意地图 · 不含真实坐标 · 示例数据…，仅用于展示标记与路线的对应关系` | L390–391、`map.js:98` |
| 路线描边 | `.route-path`（`--forest`，2.6px，85% 不透明）+ `.route-path-dash`（`--amber` 1.6px，5/6 虚线，26s 循环流动） | L406–408 |
| 标记 | `.mk` > `.mk-halo`（选中 r15 / 常规 r12）+ `.mk-body`（路线内 r11.5 / 路线外 r8.5，填充为类别色）+ 序号文字（12px 白色 700）+ 名称 `.mk-label`（10.5px，3px `#F7F5EE` 描边保证可读）+ 起终点 `.mk-tag` | L394–404、`map.js:148–164` |
| 起终点 | `.mk-start` 墨绿描边 3px；`.mk-end` 暖橙描边 3px + 暖橙标签 | L402–404 |
| 选中 | `.mk-sel`：白色 halo + 投影，序号升到 13px | L398–399 |
| 真实地图占位 | `.real-map` 高 440px；适配器标记 `.cw-marker`（24 圆形，起点墨绿 / 终点暖橙） | L363–370 |

**交互**：指针拖动平移（`map.js:201–215`，位移上限随缩放变化）、滚轮或触控板缩放（`map.js:216–220`，缩放区间 0.85–2.4 `map.js:181`）、图层切换（`map.js:223–229`）、点标记回调 `opts.onSelect`（`map.js:170–175`）、选中后轻微聚焦平移（`map.js:236–248`）。

**适配器契约**：`CW.map.render(host, route, { onSelect }) → { update(route), select(id), destroy() }`（`map.js:10–12`、`map.js:233–250`）。配置了未实现的 provider 时，不静默画错图，而是渲染琥珀提示条并回退 SVG（`map.js:270–277`）——这是「不假装」原则在地图层的一次落地（DP-001）。

**差距**：SVG 无 `role` / `aria-label`，标记不可聚焦（P1-8）；缩放只监听 `wheel`，未实现双指捏合（移动端不支持，与「当前仅桌面」定位一致，本轮不修）。

### 5.3 路线节点（同一节点的两处表示）

| 维度 | 地图标记 `.mk` | 时间线节点 `.tl-item` / `.place-card` |
| --- | --- | --- |
| 序号 | 圆内数字 `1..n`（`map.js:151`） | 左侧 `.tl-num` 数字 `1..n`（`home.js:710`）+ 图片角标 `.pc-order` 两位「01」（`home.js:712`） |
| 类别 | `.mk-body` 填充＝类别色 | `.pc-cat` 标签＝类别色文字 + 10% 淡底 |
| 名称 | `.mk-label`（超 9 字截断加省略号，`map.js:160`） | `.pc-top h4` 完整名称 |
| 起终点 | 有，`.mk-tag`「起点」「终点」 | **无** |
| 选中态 | `.mk-sel` | `.tl-item.sel` + `.place-card.sel` |
| 顺序调整 | 重绘编号 | 拖拽 / 上下按钮 / `.orderDirty` 提示 |

**数据契约**：`route.places` 是地点 id 数组（顺序即站点顺序）；`route.segments[i] = { placeId, stay, walkFromPrev }`（`home.js:701–707` 按索引取值）。地图只读 `places`，时间线两者都读。

**现存的编号不一致**：同一节点在地图上显示 `1`、时间线圆点显示 `1`、图片角标显示 `01`。三种写法并存属于细节不统一（P2-6），不影响理解，但改版时容易漏改其中一处。建议统一为「圆点用 1，图片角标去掉」（角标与圆点重复表达同一信息）。

### 5.4 行程时间线

| 元素 | 类名 / 规格 | 出处 |
| --- | --- | --- |
| 容器 | `.timeline` | L411 |
| 行 | `.tl-item`（`display:flex`，`padding-bottom:16px`，最后一行 0） | L412–413 |
| 轨道 | `.tl-rail` 30px 宽；`.tl-num` 28 圆形 2px 墨绿边；`.tl-line` 2px 虚线（`repeating-linear-gradient` 4px 实 4px 空），最后一行隐藏 | L414–422 |
| 卡片 | `.place-card`：`grid-template-columns:132px 1fr`，`--r-md` | L424–427 |
| 图片 | `.pc-img` 最小高 132px，封面 `background-size:cover`；角标 `.pc-order` | L432–433 |
| 正文 | `.pc-body` → `.pc-top`（标题 + 操作）→ `.pc-reason`（左 2px 墨绿线 + 推荐理由）→ `.pc-meta`（停留 / 消费 / 营业时间）→ `.pc-foot`（到下一站步行 + 查看详情） | L434–444 |
| 操作 | `.fav-btn` 28 心形（`.on` 变 `--rose`）；`.sort-btn` 26 上移/下移（`.disabled` 时 35% 不透明） | L446–453 |
| 选中 | `.place-card.sel`：墨绿边 + 3px `--forest-soft` 外环 + `--sh-2` | L429 |
| 拖拽中 | `.place-card.dragging`：45% 不透明 + 虚线边 | L430 |
| 投放目标 | `.place-card.drop-target`：暖橙虚线边 + `--amber-soft` 底 | L431 |

**交互**：点卡片选中（与地图联动，`home.js:671–672`）、拖拽换序（`home.js:675–698`）、上下按钮换序（`home.js:759–765`）、打开详情（`home.js:669–670`）。

**顺序变化后的文案分叉**（`home.js:704–707`）：

- 正常：`步行约 N 分钟到下一站（估算）`；
- 手动排序后：`与下一站的距离待重新计算`；
- 最后一站：`路线终点`。

这是「不假装重算」的落点：用户看到的每一段路程数字，都能对应到它是否被重新计算过。

**差距**：卡片整体可点，但是 `div`（P0-5）；时间线末尾没有「合计」行，总时长只在上方摘要卡里（可接受，但滚动到末尾时无法就地确认总量，作为 P2 记录）。

### 5.5 路线摘要卡

| 区域 | 内容 | 出处 |
| --- | --- | --- |
| 眉标 `.sc-eyebrow` | 11px 大写间距，按来源切换：`AI Planned · 模拟规划结果` / `Curated Route · 精选路线` | L329、`home.js:568` |
| 标题 `h2` | 23px 衬线、白字 | L330 |
| 风格标签 `.sc-style` | 白 13% 底 + 白 75% 文字的小胶囊 | L331–332 |
| 指标 `.sc-metrics` | 2×2 网格：总时长 / 地点数量 / 步行距离 / 预算估算（带「未指定预算」说明） | L333–337、`home.js:571–577` |
| 操作 `.sc-actions` | 收藏路线（暖橙）/ 重新规划 / 编辑条件 / 分享路线（半透明白） | L338–343、`home.js:578–583` |
| 提示区 | 最多 5 块：冲突（琥珀）→ 时间偏紧（蓝）→ 时间富余（蓝）→ 免责（默认）→ 顺序已调整（蓝） | `home.js:585–596` |

**差距**：4 个操作 + 最多 5 条提示堆叠在同一张深色卡下方，是结果页视觉最重的位置（P2-10）。建议把 3 条以上的提示收进一个「数据与限制说明」折叠区，但**不能删掉免责说明**。

---

## 六、AI 状态

本产品的 AI 状态有三层：**进行中**（loading）、**结果的可信度**（result）、**能力真假**（mock / remote / degraded）。三层必须分开表达，混在一起就会出现「用转圈动画暗示真实 AI」这类误导。

### 6.1 生成中

| 维度 | 现状 |
| --- | --- |
| 状态机 | `state.view`: `idle` → `loading` → `result`（`app.js:24`） |
| 入口 | 主按钮 `.btn-primary.btn-lg#genBtn`；生成中文案变为「正在为你规划…」并 `disabled`（`home.js:77`、`139`） |
| 右栏 | 整块替换为 `.loading-wrap`：旋转环 + 「正在为你规划路线」+ 副文案「预计几秒内完成，你可以继续修改左侧的条件」+ 4 步列表（`home.js:469–479`） |
| 四步文案 | 理解出行偏好 → 筛选合适的地点 → 组织路线顺序 → 检查时间与路线约束（`home.js:10–15`） |
| 步进节奏 | 每步 420–640ms 随机（`home.js:375`），即总感知时长约 1.7–2.6 秒；mock 层自身延迟 120–280ms（`agent.js:668`） |
| 并发保护 | `busy` 标志防止重复点击（`home.js:20`、`345`） |
| 左栏 | 保持可编辑（明确告知「你可以继续修改左侧的条件」）——这是好设计，不要把整页锁死 |
| 失败 | 不留在加载态：回到上一个结果或空态，对话里插入错误气泡（`home.js:381–390`） |

**当前缺失，建议新增**：取消/中止。现在 1.7–2.6 秒内用户无法放弃这次生成（P1-3）；也不需要为 mock 加真取消，只要在加载态提供「取消」并在 `state.view` 回退即可，接真实服务时同一入口可接 `AbortController`。

### 6.2 结果的可信度（当前如何表达）

**没有「可信度分数」这类组件，也建议不要加**——一个 0–100 的分数在没有真实数据源时是新的虚构。当前用 6 个具体通道表达「哪些是真的、哪些是估的」：

| 通道 | 表达方式 | 位置 |
| --- | --- | --- |
| 来源眉标 | `AI Planned · 模拟规划结果` / `Curated Route · 精选路线` | `.sc-eyebrow` `home.js:568` |
| 全局免责 | 4 条 `D.DISCLAIMER` 拼在结果区 | `home.js:591–594`、`data.js:278–283` |
| 逐项标注 | 「建议停留 N 分钟」「（估算）」「信息待确认」「未指定」 | `.pc-meta` `home.js:729–733`；`.cond-row .v.miss` `home.js:164–168` |
| 地图说明 | 「示意地图 · 不含真实坐标」常驻地脚 | `.map-note` `map.js:98` |
| 顺序可信度 | 手动排序后「距离与时间未重新计算」 | `home.js:595–596`、`744–757` |
| 来源区分 | 精选路线在对话里说明「地点顺序为预设内容」 | `home.js:847` |

**差距（P1-1）**：`route.notes` 被写入 4 处（`agent.js:271–272`、`656`；`home.js:391`），但**没有任何界面渲染它**。也就是说，AI 层精心收集的说明文案全部丢弃，只剩下页面里手写的那一条免责行。修复很小：在摘要卡下方渲染 `r.notes`，或在「数据说明」折叠区列出。

### 6.3 降级与重试

```
CW.agent.run(task, payload)
  ├─ mode !== 'remote'                 → 本地模拟（mock 延迟后返回）
  └─ mode === 'remote'
       ├─ 成功 → 返回远程结果
       └─ 失败 → fallback === 'mock' ? 本地模拟 + degraded:true + degradeReason
                                     : 抛错给界面
```

- 配置项：`agent.fallback`（`'mock' | 'error'`）、`agent.timeoutMs` 默认 20000（`config.js:45–47`、`agent.js:22–30`）。
- 界面反馈：对话气泡「已切换为本地模拟」+ 具体原因（`home.js:415–417`、`456–459`）；错误路径是「规划服务暂时不可用」/「调整失败」。
- 重试：结果的「重新规划」按钮会重跑完整生成（`home.js:580`）；对话失败**没有**就地重试，需要用户重新输入。

**差距（P1-2）**：错误气泡里没有「重试」动作；且 `degradeReason` 直接把 `err.message`（可能是「请求超时」「HTTP 500」）透给用户，属于技术词汇外泄（`04-文案规范.md` 已列为禁区）。建议：错误气泡加「重试」按钮，文案映射为「网络不稳定，已改用本地规划」这类用户语言。

### 6.4 Mock / Remote 标识

| 显示点 | 文案 | 驱动来源 |
| --- | --- | --- |
| AI 面板副标题 | `演示模式 · 本地规则模拟` / `已连接智能体服务` | `A.status().connected`（`home.js:181`、`agent.js:687–695`） |
| 生成按钮下方 | `演示模式 · 本地模拟规划，未接入真实地图与导航服务` + 闪烁圆点 | 写死在 `home.js:141`，圆点动画 L304 |
| 降级气泡 | `已切换为本地模拟` | 返回值的 `degraded` 字段 |

**规则**：标识必须由 `CW.agent.status()` 或返回值的 `degraded` 驱动，不得写死（DP-005）。

**差距（P2-8）**：`config.js` 第 102 行的 `app.showDemoBadge` 开关**从未被任何代码读取**，改它不会隐藏标识。要么接上（`home.js:181` 用它控制显示），要么删掉这个配置项，避免部署方以为能关。

---

## 七、键盘可操作性与可访问性

### 7.1 键盘可达性现状

| 交互 | 键盘可用 | 依据与问题 |
| --- | --- | --- |
| 生成路线 / 收藏 / 分享 / 重新规划 | ✅ | 都是真实 `<button>`，Enter 与 Space 原生可用 |
| 表单填写（位置 / 时间 / 预算 / 下拉） | ✅ | 原生控件，但标签未用 `for` 关联（P0-3） |
| 兴趣标签（两处同步） | ⚠️ | 可 Tab 可回车，但选中态只有 `.on` 类，没有 `aria-pressed` |
| 分段控件（时长 / 节奏 / 交通） | ⚠️ | 同上，且没有 `role` 说明这是一组单选 |
| 高级筛选展开 | ⚠️ | 按钮可点，但没有 `aria-expanded` / `aria-controls` |
| 对话输入与发送 | ✅ | `Enter` 发送（`home.js:283`）；输入框是单行 `input`，无换行冲突 |
| 对话快捷指令 / 冲突选项 | ✅ | 都是 `<button>` |
| 时间线卡片选中（与地图联动） | ❌ | `.place-card` 是 `div`，只有 click 监听（`home.js:671–672`） |
| 地图标记选中 | ❌ | SVG `<g class="mk">`，无 `tabindex`、无键盘事件（`map.js:156–164`） |
| 调整顺序 | ✅ | 除拖拽外，提供上移/下移按钮（`home.js:724–725`）——这是拖拽的键盘等价物，做得对 |
| 弹窗关闭 | ⚠️ | `Esc` 可关（`ui.js:106`），但打开时不聚焦、关闭后不归还焦点，Tab 能走进背景内容（P0-4） |
| 下拉菜单（城市 / 头像） | ⚠️ | 子项是 `<button>` 可 Tab，但 `Esc` 不关闭、无 `aria-expanded`（P1-7） |
| Toast 提示 | ❌ | 无 `aria-live`，读屏用户听不到任何操作反馈（P0-6） |

### 7.2 焦点样式

- **输入类**有自定义焦点：`.input:focus` / `.textarea:focus` / `.select:focus` / `.chat-input input:focus` 都是「`outline:none` + 边框变 `--forest-3` + 3px `--forest-soft` 光晕」（L225、L492）。边框本身 5.09:1，满足；光晕 1.16:1 不满足，但只作为辅助，可以接受。
- **按钮类没有自定义焦点**，依赖浏览器默认 ring。在 `--cream` 底上默认 ring 仍可见，但 `.fav-btn`（28px）与 `.sort-btn`（26px）这类小图标按钮的默认 ring 容易被忽略，且不同浏览器表现不一致。
- **建议（P1-10）**：新增一条统一规则 `.btn:focus-visible, .pill:focus-visible, .nav-item:focus-visible, .place-card:focus-visible, .fav-btn:focus-visible { outline:2px solid var(--forest-3); outline-offset:2px }`，不改动任何现有颜色与布局。

### 7.3 ARIA 现状与最小补齐集合

**现状**：全仓库 `aria-*` 属性 **0 个**、`role` **0 个**（`js/` 目录下 grep 确认；只有 1 处 `Escape` 键处理，在 `ui.js:106`）。`<html lang="zh-CN">` 正确（`index.html:2`），标题、`viewport` 存在，`viewport` 固定 `width=1440`（见 7.4）。

| 元素 | 需要补 | 为什么 |
| --- | --- | --- |
| `.modal`（`ui.js:96`） | `role="dialog"` `aria-modal="true"` `aria-labelledby`（指向 `.modal-head h3`） | 读屏用户否则不知道出现了一个新层 |
| `.close-x`（`ui.js:99`） | `aria-label="关闭"` | 按钮内只有 SVG，无可访问名称（**P0-4**） |
| `.adv-toggle`（`home.js:98`） | `aria-expanded` + `aria-controls="advPanel"` | 折叠状态对读屏不可见 |
| `#cityBtn` / `#avatarBtn`（`app.js:70`、`app.js:101`） | `aria-haspopup="menu"` + `aria-expanded` | 同上；并补 `Esc` 关闭 |
| 兴趣 `.pill`（`home.js:95`、`125`） | `aria-pressed` | 多选标签需要暴露开关状态 |
| `.seg button`（`home.js:115`、`121`、`129`） | `role="radiogroup"` + `aria-checked`（或 `aria-pressed`） | 三组分段控件实际是单选 |
| `.place-card`（`home.js:711`） | `role="button"` `tabindex="0"` + Enter/Space | 结果页核心交互（**P0-5**） |
| `.fav-btn`（`home.js:723`） | `aria-pressed` + `aria-label`（已有 `title` 可作后备） | 收藏是可切换状态 |
| `.map-stage svg`（`map.js:80`） | `role="img"` + `aria-label="路线示意图，编号与下方时间线一致"` | 否则读屏只读到一堆图形（**P1-8**）；标记可加 `aria-hidden="true"`，因为时间线已提供等价信息 |
| `.map-layers button`（`map.js:87–89`） | `aria-pressed` | 图层开关状态 |
| `.toast-root`（`index.html:37`） | `role="status"` `aria-live="polite"`（错误用 `alert`） | 所有操作反馈（**P0-6**） |
| `.loading-steps`（`home.js:474`） | `role="status"` `aria-live="polite"` + `aria-busy` | 生成进度（**P0-6**） |
| `.field label`（`home.js:105–132`） | `for` + 对应 `id` | 标签与控件关联（**P0-3**） |
| `#promptInput`（`home.js:85`） | `aria-label="出行需求描述"` | 大输入区只有 placeholder，没有可访问名称（**P0-3**） |

**注意**：以上全部是**属性级改动**，不新增 DOM 结构、不改类名、不改视觉。这正是把它放进「最小改动集」的原因——`tests/smoke.js` 与 `tests/checks.js` 依赖的选择器（`.modal-mask`、`.place-card`、`.pill`、`#cityMenu` 等）都不会失效。

### 7.4 响应式断点与信息层级

**断点现状（只有 1 个）**：

```css
@media (max-width:1280px){
  .workspace     { grid-template-columns:minmax(0,44fr) minmax(0,56fr); }
  .route-grid    { grid-template-columns:repeat(2,1fr); }
  .discover-grid { grid-template-columns:repeat(2,1fr); }
}
```

`css/style.css` 第 600–604 行。除此之外，所有布局在 1440px 设计宽度下固定：`.topbar-inner` 与 `.view` 都是 `max-width:1440px`，两栏固定 `42fr / 58fr`，`.adv-grid` 固定 2 列，`.grid-2` 固定 2 列。

**视口**：`<meta name="viewport" content="width=1440">`（`index.html:5`）。这意味着在手机上浏览器会按 1440 CSS px 渲染再整体缩小，文字会非常小——**这是「桌面端原型」定位的直接后果，不是 bug**；但任何「支持手机」的说法在补齐适配前都站不住。

**信息层级（现状四级）**：

| 层级 | 字号 | 颜色 | 用途 |
| --- | --- | --- | --- |
| 页面级 | 25–27px / 700 | `--ink` | 页面标题、首屏主标题 |
| 区块级 | 15.5–18px / 700 | `--ink` | 卡片标题、区块标题 |
| 正文级 | 13.5–14px / 400 | `--ink` / `--ink-2` | 说明、描述 |
| 元信息级 | 11–12.5px / 400–600 | `--ink-3` | 时长、距离、营业状态、辅助说明 |

**关键问题**：第三级到第四级的区分完全依赖 `--ink-3`，而 `--ink-3` 在四种背景上的对比度只有 2.66–3.05（P0-1）。所以「视觉层级」在正常人眼里成立，在低视力用户眼里第四级直接消失。**修复层级问题的方法不是加更多颜色，而是把 `--ink-3` 提到合规亮度，让层级靠字号与字重继续成立。**

**建议（P1-11，本轮不改，写入规划）**：若要支持 1024–1280 的笔记本与平板，最小改动是新增一个 `@media (max-width:1024px)`：`.workspace` 单列堆叠（左栏在上）、`.route-grid` / `.discover-grid` 2 列、`.adv-grid` 保持 2 列。再往下到 768 才需要重排顶栏与地图高度——那是一次独立改版，不在本轮范围。

**触控目标**：`.fav-btn` 28px、`.sort-btn` 26px、`.close-x` 30px、`.map-ctrl button` 32px、`.icon-btn` 34px。WCAG 2.5.8（AA，2.2）要求最小 24×24 CSS px，全部满足；但距离常见的 44px 触控建议有差距，属于移动端适配时再统一处理。

### 7.5 动效与降级

| 动效 | 位置 | 是否可关闭 |
| --- | --- | --- |
| `blink`（AI 状态点，1.6s 无限） | `.dot-live` L304 | 否 |
| `dash`（路线虚线流动，26s 无限） | `.route-path-dash` L407 | 否 |
| `spin`（加载环 1.1s / 步骤环 .8s） | L497–498、L506 | 否 |
| `sk`（骨架扫光，未使用） | L251 | — |
| `pop` / `fade` / `rise` / `toastIn`（一次性） | L165、L558、L563、L582 | 否 |

**建议（P1-6）**：加一段全局降级——

```css
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
}
```

这不是「加一个开关」，而是 WCAG 2.2.2（暂停、停止、隐藏）与 2.3.3 的最低要求：`.dot-live` 与 `.route-path-dash` 都是自动开始、持续超过 5 秒、且与内容并排的运动。

---

## 八、现有实现与规范的差距清单

**分级标准**：

- **P0**：明确违反 WCAG 2.1 AA，且出现在主流程（首页生成 → 查看结果 → 收藏 / 发现），会让某类用户**用不了**或**读不到关键结果**。必须修，且修复不得改变视觉语言。
- **P1**：违反 AA 但影响次要路径，或需要小结构改造；本轮可修则修，不可修则写入下一版。
- **P2**：不违反标准，属于一致性、可维护性与细节问题。**不为了改而改**，只在顺路改动时处理。

### 8.1 P0（6 项，全部可只改颜色/属性）

| 编号 | 问题 | 证据 | 影响 | 最小修复 |
| --- | --- | --- | --- | --- |
| **P0-1** | 辅助文字对比度不足：`--ink-3` 2.88–3.05、`--ink-4` 1.96–2.08 | L232、L178、L274、L446、L502、L530、L592；实测见 1.3 | 低视力用户读不到时长/距离/营业状态/空状态引导，而这些都是决策依据 | `--ink-3` → `#5F6860`（白底 5.78 / 纸面 5.45）；`--ink-4` → `#6B746C`（白底 4.84 / 纸面 4.56）。两级仍可区分，层级不靠降低对比度实现 |
| **P0-2** | 暖橙按钮白字 2.93:1 | `.btn-amber` L189、`.btn-amber-on-dark` L342；用在 `home.js:506`「一键体验」、`home.js:579`「收藏路线」 | 两个高频按钮的文字不可读 | 方案 A（推荐）：白字改 `--ink`（`#1E2A22` on `#D9822B` = 5.09）；方案 B：底色加深到 `#A05E14`（白字 5.11）。A 完全保留现有橙色的视觉重量 |
| **P0-3** | 表单标签未与控件关联；需求输入框无可访问名称 | `home.js:105–132` 的 `<label>` 无 `for`；`home.js:85–86` 的 textarea 只有 placeholder | 读屏用户听到「编辑框」而不知填什么；占位符本身 2.08:1 | 给每个 label 加 `for`、给控件加对应 `id`（部分已有 id）；`#promptInput` 加 `aria-label`。纯属性改动 |
| **P0-4** | 弹窗无 `role="dialog"` / `aria-modal` / 焦点管理；关闭按钮无名称 | `ui.js:91–112`；`.close-x` L569 | 读屏不播报新层；Tab 会走到遮罩后的页面；关闭按钮无名称 | `U.modal()` 内补 3 个属性 + 打开时 `focus()` 面板 + 关闭后归还焦点；`.close-x` 加 `aria-label="关闭"` |
| **P0-5** | 时间线卡片与地图标记只能鼠标操作 | `.place-card` 为 `div`（`home.js:711`）；SVG `.mk` 无 `tabindex`（`map.js:156–164`） | 键盘用户无法核对/选中路线节点——这是结果页的核心动作 | 卡片加 `role="button" tabindex="0"` + Enter/Space 触发 `selectPlace`；地图标记加 `aria-hidden="true"`（时间线已是等价内容） |
| **P0-6** | Toast 与生成进度没有 live region | `ui.js:74–88`；`home.js:469–479` | 收藏、复制、排序后果、生成进度对读屏用户完全无声 | `#toastRoot` 加 `role="status" aria-live="polite"`（错误用 `alert`）；`.loading-steps` 加 `role="status" aria-busy` |

### 8.2 P1（12 项）

| 编号 | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| **P1-1** | `route.notes` 生成但从不渲染 | 写入 `agent.js:271–272`、`656`、`home.js:391`；无任何读取处 | 在摘要卡下方或「数据说明」折叠区渲染 `r.notes`，让 AI 的说明真正到达用户 |
| **P1-2** | 错误气泡无重试；技术词汇外泄 | `home.js:387`（含 `config.js`）、`448` | 加「重试」按钮；把 `degradeReason` 映射为用户语言 |
| **P1-3** | 生成中不可取消 | 1.7–2.6s 内只能等待（`home.js:372–378`） | 加载态加「取消」，回退 `state.view`；接真实服务时同一入口接 `AbortController` |
| **P1-4** | 非文本对比不足：输入框边框 1.33:1 | `--line` L222 对 `--white`；SC 1.4.11 要求 3:1 | 新增 `--line-strong: #948C7B`（对白 3.34）只用于表单控件边界；卡片边框保持 `--line` |
| **P1-5** | 表单无 `invalid` 态、无必填标识 | `.input` 只有 focus 与占位符（L221–227） | 新增 `.field.invalid .input` + `.field-err` 文案槽；必填项加 `aria-required` |
| **P1-6** | 无 `prefers-reduced-motion` 降级 | L304、L407、L497 | 加 7.5 节的全局降级块 |
| **P1-7** | 下拉菜单无 `aria-expanded`、`Esc` 不关闭 | `app.js:77–79`、`108–110`、`124–128` | 补属性 + 补 `Esc` 监听（与弹窗一致） |
| **P1-8** | 地图 SVG 无 `role` / `aria-label` | `map.js:80` | 补 `role="img"` + 说明；标记 `aria-hidden` |
| **P1-9** | 类别色承载文字的对比度：4 个类别白字 <4.5，8 个 `.pc-cat` 全部 <4.5 | `data.js:33–40`、`home.js:718`、`map.js:158` | 白字标记：把 `street/cafe/park/photo` 加深到 `#6B7A6F/#9E5F39/#43764E/#7A6B98`（分别 4.53/5.06/5.33/4.79）；`.pc-cat` 文字改用 `--ink-2`（5.39–5.52），保留色点表达类别 |
| **P1-10** | 按钮类无统一焦点样式 | `.btn` L180 无 `:focus-visible` | 加 7.2 节的一条 `:focus-visible` 规则 |
| **P1-11** | 视口固定 1440，只有 1 个断点 | `index.html:5`、L600–604 | 明确「当前仅支持 ≥1280 桌面」；支持平板时新增 1024 断点（单列堆叠） |
| **P1-12** | 暖橙 / 玫红文字标签临界不达标 | `--amber-2` on `--amber-soft` 3.69（L215）、on 白 4.09（L351）；`--rose` on `--rose-soft` 4.17（L217） | 新增 `--amber-ink: #8A5A15`（5.34 / 5.91）用于文字型标签；`--rose` 加深到 `#A8504A`（4.71） |

### 8.3 P2（13 项，顺路处理，不单独排期）

| 编号 | 问题 | 证据 |
| --- | --- | --- |
| **P2-1** | 8 个 `--c-*` 类别色变量 0 引用；与 `data.js:33–40` 重复维护 | L31–39、`data.js:33–40` |
| **P2-2** | 21 个硬编码色值 / 34 处，其中约 15 个缺少命名 token | 见 1.5 节 |
| **P2-3** | 19 档字号，含 4 个 0.5px 档 | 见 2.2 节 |
| **P2-4** | 0 个间距 token，234 处 px 值、33 种 | 见 3.1 节 |
| **P2-5** | 圆角特例：`.sort-btn` 6px、`.brand-mark` 10px、滚动条 9px | L450、L93、L76 |
| **P2-6** | 同一节点三种编号写法（地图 `1`、圆点 `1`、图片角标 `01`） | `map.js:151`、`home.js:710`、`home.js:712` |
| **P2-7** | 定义了但全站未使用的样式：`.skel`、`.btn-icon`、`.tag-blue`、`.tag-rose`、`.grid-3` | L251、L198、L216–217、L548 |
| **P2-8** | `app.showDemoBadge` 配置项从未被读取 | `config.js:102` |
| **P2-9** | 禁用按钮白字 1.83（WCAG 豁免，但可读性差） | L188 |
| **P2-10** | 摘要卡下方最多堆 5 条提示条 | `home.js:585–596` |
| **P2-11** | 收藏态只有文案变化，扫视不可见 | `discover.js:94–95` |
| **P2-12** | 时间线末尾无合计行 | `home.js:644–659` |
| **P2-13** | `.adv-panel.open` 固定 `max-height:760px`，内容变多会被裁 | L292 |

**关于「只列必要调整」的说明**：以上 P0 全部是**读不到 / 用不了**的问题；P1 全部是「会挡住一部分用户」或「信息没到达用户」的问题；P2 只记录、不主动改。没有任何一条是为了「更好看」而提的——视觉语言本身不需要重做（第 9 节说明理由）。

---

## 九、设计决策：为什么保留现有视觉语言

### 9.1 结论

**保留现有视觉语言，本轮只做「属性 + 色值」级改动，不做视觉重构、不做布局调整、不重画组件。** 这不是保守，而是因为下面五条理由都指向同一件事：现有语言已经成立，问题在可访问性而不是审美。

### 9.2 五条理由

1. **品类契合，且意图是显式写下的。** `css/style.css` 第 1–4 行的文件头就写明「墨绿 + 米白 + 暖橙 · Editorial / 城市生活方式杂志气质」。CityWalk 卖的是「慢」「在地」「生活质感」，用 SaaS 常用的蓝白后台色系会直接把这层意思抹掉。三页（首页 / 发现 / 收藏）都贯彻了这套语言，没有一页破例。

2. **已经形成可识别的品牌资产。** 两块视觉签名：`.brand-mark`（34px 墨绿方块 + 曲线 logo + 橙色 `AI` 小标，L92–99）与 `.summary-card`（深绿底 + 衬线标题 + 2×2 指标 + 风格小胶囊，L324–343）。任何一张截图里这两块都能被认出来——这是重做配色要付出的最大代价。

3. **信息架构与视觉语言是耦合的，不能单独换。** 42/58 两栏、左输入右结果、结果区「摘要 → 地图 → 时间线」的顺序，靠「深绿摘要卡 = 结论」「纸白卡片 = 过程」建立层级。如果换成蓝白或纯浅色系，「深色 = 确定的结论」这条语义就会断掉（第 0 节原则 1、2），摘要卡与提示条的关系也随之模糊。要换配色，等于重做信息层级，不是换色号。

4. **语义色只有四个槽，扩展成本极低。** `forest`=确定 / 主操作，`amber`=行动 / 提醒，`blue`=信息 / 时间，`rose`=风险 / 收藏。新页面只要按槽取色就不会出错。相比之下，常见的「七彩状态色」体系需要为每个新状态讨论颜色，这才是长期成本高的那种方案。

5. **改动成本高、收益不可测，而且 P0 根本不需要改结构。** `tests/smoke.js`（68 项）与 `tests/checks.js`（31 项）依赖 `.modal-mask`、`.place-card`、`.pill`、`#cityMenu`、`#avatarMenu`、`data-act` 等选择器与属性；一旦重构 DOM，99 项自检会成片失效，而视觉收益没有任何指标可衡量。反过来看第 8 节：6 条 P0 全部可以在**不改类名、不改 DOM、不改布局**的前提下修完（改 3 个色值、加 6 类属性）。

### 9.3 本轮明确不改（避免下一轮重复讨论）

| 不改的东西 | 理由 |
| --- | --- |
| 主色相 `--forest: #1F3D2B` | 品牌识别核心 |
| 42 / 58 两栏比例 | 信息架构的一部分，与「左输入右结果」绑定 |
| 卡片 16px 圆角、三级阴影 | 现有层级已经够用，加第四级只会更乱 |
| 衬线的使用范围（仅 3 处） | 再扩就变「文艺模板」 |
| 40+ 内联 SVG 图标（1.7 描边） | 自成体系，重画不会更好 |
| 引入 UI 框架 / 图标库 | 与「无依赖、可离线」的技术约束冲突 |
| 暗色模式 | `--cream` 纸面底是识别的一部分；要做需独立配色 + 全套对比度复核，属于独立项目 |

### 9.4 本轮会改（与第 8 节一一对应）

| 改动 | 对应差距 | 视觉影响 |
| --- | --- | --- |
| `--ink-3` 加深到 `#5F6860`、`--ink-4` 到 `#6B746C` | P0-1 | 辅助文字「更清楚」，层级仍靠字号与字重成立 |
| 暖橙按钮文字改 `--ink`（或底加深） | P0-2 | 按钮「更清楚」，橙色面积与位置不变 |
| 表单 `label for`、`aria-label` | P0-3 | 无视觉变化 |
| 弹窗 `role` / `aria-modal` / 焦点管理 / 关闭按钮名称 | P0-4 | 无视觉变化（focus 描边属于键盘态） |
| 卡片 `role` / `tabindex`、地图标记 `aria-hidden` | P0-5 | 无视觉变化（focus 描边属于键盘态） |
| Toast / 加载 live region | P0-6 | 无视觉变化 |
| 类别色微调、`.pc-cat` 文字色、`--line-strong` | P1-9、P1-4、P1-12 | 4 个类别色略深一档；标签文字从彩色变 `--ink-2` |

**一句话**：改完之后，界面应该「看起来一样，但读得出来、点得到、听得见」。

---

## 附录 A：token ↔ 类名速查（要改什么，看哪一行）

| 想改的效果 | 改这个 | 会影响到 |
| --- | --- | --- |
| 主操作按钮颜色 | `--forest` / `--forest-2` | `.btn-primary`、`.nav-item.on`、`.pill.on`、`.seg button.on`、`.map-layers button.on` |
| 页面底色 / 卡片底 | `--cream`、`--cream-2`、`--white` | `body`、`.prompt-box`、`.note-box`、`.card` |
| 正文 / 说明文字 | `--ink`、`--ink-2`、`--ink-3`、`--ink-4` | 所有文字层级（见 2.2、7.4） |
| 边框粗细感 | `--line`、`--line-2`、`--forest-line` | 卡片、输入框、分隔线、悬停描边 |
| 强调 / 提醒 | `--amber`、`--amber-2`、`--amber-soft` | `.btn-amber`、`.tag-amber`、`.dot-live`、地图终点、`.note-box.amber` |
| 信息 / 时间提示 | `--blue`、`--blue-soft` | `.note-box.blue`、`.tag-blue` |
| 风险 / 收藏 | `--rose`、`--rose-soft` | `.fav-btn.on`、`.toast.err`、`.note-box.rose` |
| 卡片圆角 | `--r-lg`、`--r-md`、`--r-sm` | 见 3.2 表 |
| 阴影层级 | `--sh-1`、`--sh-2`、`--sh-3` | 见 3.4 表 |
| 标题字体 | `--serif` | 仅 `.brand-text b`、`.summary-card h2`、`.rc-body h3` |
| 断点 | `L600` 的 `@media (max-width:1280px)` | `.workspace`、`.route-grid`、`.discover-grid` |

## 附录 B：新增组件前的检查清单（10 条）

1. **语义色**：属于四个槽中的哪一个？有没有抢 `--amber` 的「行动」含义？
2. **圆角**：是否落在 16 / 12 / 9 / 999 四级之内？
3. **阴影**：是否不超过 `--sh-3`，且没有新增第四级？
4. **文字对比度**：普通文本 ≥4.5:1，大文本（≥18.66px 粗体 或 ≥24px）≥3:1？
5. **非文本对比**：边框、图标、状态点 ≥3:1？
6. **焦点**：键盘 Tab 到这个元素时，眼睛能不能看见焦点？
7. **可访问名称**：纯图标按钮有没有 `aria-label` 或可见文字？
8. **状态语义**：可切换的控件有没有 `aria-pressed` / `aria-expanded` / `aria-selected`？
9. **三态**：空态、错误态、加载态是否都有？错误态有没有出路（重试 / 修改 / 返回）？
10. **文案**：是否通过 `04-文案规范.md` 第八节的禁区检查（无「实时」「精准」「保证」「已接入大模型」）？

## 附录 C：本轮明确不做 / 留给下一版

| 事项 | 为什么不做 | 什么时候做 |
| --- | --- | --- |
| 移动端适配 | 当前定位是桌面端原型，`viewport width=1440`；改造成本属于一次独立改版 | 产品决定支持手机时 |
| 暗色模式 | 纸面底是品牌识别的一部分，需要独立配色与全套对比度复核 | 有明确诉求时 |
| 字号体系收敛（19 → 8 档） | 会引发整站视觉回归，收益是维护成本 | 下一次大改版，与组件整理一起做 |
| 间距 token 落地 | 同上，234 处数值不能一次性替换 | 同上 |
| 组件库化 | 单页原生实现已经够用，抽组件库会增加构建依赖，与技术约束冲突 | 页面数量显著增加时 |
| 地图移动端手势（双指缩放） | 桌面端不需要 | 移动端适配时 |

## 附录 D：版本记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-10-26 | 首次建立。从现有 `css/style.css`（604 行）与三个页面脚本中提取：39 个 `:root` 变量、19 档字号、10 种行高、5 种字重、67 处圆角声明、29 处阴影声明；完成 WCAG 2.1 AA 对比度实算，列出 6 项 P0、12 项 P1、13 项 P2；给出「只改属性与色值」的最小改动集。 |

**维护约定**：本文件与 `docs/design/tokens.json`、`css/style.css` 的 `:root` 三者必须一致。修改顺序：先改 `:root` → 再改 `tokens.json` → 最后更新本文件对应表格与版本记录。任何「只在文档里改、代码没改」的条目，必须在对应位置标注「建议」而非「现状」。
