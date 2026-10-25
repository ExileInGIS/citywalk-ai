/* =====================================================================
 * data.js · 数据层
 * ---------------------------------------------------------------------
 * ⚠️ 数据来源说明（重要）
 *  - 本文件全部为【演示用模拟数据】，用于展示产品结构与交互逻辑。
 *  - 地点名称取自真实城市地标（便于理解语境），但：
 *      · 停留时长、消费区间、步行耗时、距离 均为【估算值】；
 *      · 营业时间一律为 null → 界面显示「信息待确认」；
 *      · 不含真实坐标，地图为【示意地图】，不是真实导航结果。
 *  - 真实部署前需接入地图/POI 服务（高德/百度/Google Places）核验。
 * ===================================================================== */
(function () {
  const CW = (window.CW = window.CW || {});

  /* ---------------- 图片来源（本地素材，非实时抓取） ---------------- */
  const IMG = {
    yihc:      'assets/img/yihc.jpg',       // 联排建筑街区俯瞰
    cafe1:     'assets/img/cafe1.jpg',      // 街角咖啡馆
    book1:     'assets/img/book1.jpg',      // 书店书架
    book2:     'assets/img/book2.jpg',      // 书店廊道
    laomd:     'assets/img/laomd.jpg',      // 老城石板小巷
    qinhuai:   'assets/img/qinhuai.jpg',    // 河畔老城建筑
    park1:     'assets/img/park1.jpg',      // 城市公园步道
    park2:     'assets/img/park2.jpg',      // 林荫步道
    xinjiekou: 'assets/img/xinjiekou.jpg',  // 城市商业街
    night:     'assets/img/night.jpg',      // 黄昏城市夜景
    food:      'assets/img/food.jpg',       // 本地小馆餐桌
    market:    'assets/img/market.jpg'      // 城市露台公共空间
  };

  /* ---------------- 类别定义 ---------------- */
  const CATEGORIES = {
    street:  { name: '街区漫步', color: '#7A8B7F' },
    cafe:    { name: '咖啡馆',   color: '#B4744A' },
    book:    { name: '独立书店', color: '#4E7A8A' },
    history: { name: '历史街区', color: '#8A6A4B' },
    park:    { name: '公园绿地', color: '#4F8A5C' },
    arch:    { name: '建筑街区', color: '#6B6E9A' },
    food:    { name: '本地特色', color: '#B4574F' },
    photo:   { name: '摄影点位', color: '#8A7BA8' }
  };

  /* ---------------- 城市 ---------------- */
  const CITIES = [
    { id: 'nanjing', name: '南京', ready: true,  note: '示例数据完整' },
    { id: 'suzhou',  name: '苏州', ready: false, note: '筹备中' },
    { id: 'hangzhou',name: '杭州', ready: false, note: '筹备中' },
    { id: 'shanghai',name: '上海', ready: false, note: '筹备中' },
    { id: 'chengdu', name: '成都', ready: false, note: '筹备中' }
  ];

  /* ---------------- 主题 ---------------- */
  const THEMES = [
    { id: 'arch',    name: '城市建筑', interests: ['城市摄影'] },
    { id: 'coffee',  name: '咖啡漫游', interests: ['咖啡与甜品'] },
    { id: 'art',     name: '文艺街区', interests: ['独立书店', '本地特色'] },
    { id: 'history', name: '历史文化', interests: ['历史文化'] },
    { id: 'park',    name: '公园绿道', interests: ['公园与绿地'] },
    { id: 'photo',   name: '摄影路线', interests: ['城市摄影'] }
  ];

  /* ---------------- 兴趣标签（首页快捷标签） ---------------- */
  const INTERESTS = [
    { id: 'coffee',  name: '咖啡与甜品', themes: ['coffee'],  cats: ['cafe'] },
    { id: 'history', name: '历史文化',   themes: ['history'], cats: ['history'] },
    { id: 'photo',   name: '城市摄影',   themes: ['photo', 'arch'], cats: ['photo', 'arch', 'street'] },
    { id: 'book',    name: '独立书店',   themes: ['art'],     cats: ['book'] },
    { id: 'park',    name: '公园与绿地', themes: ['park'],    cats: ['park'] },
    { id: 'local',   name: '本地特色',   themes: ['art'],     cats: ['food', 'street'] }
  ];

  /* ---------------- 步行强度 ---------------- */
  const PACES = [
    { id: 'light', name: '轻松',     desc: '每小时约 1 个地点，多留休息时间', stayFactor: 1.25, placeBudget: 0.8 },
    { id: 'mid',   name: '适中',     desc: '节奏均衡，适合大多数出行',       stayFactor: 1.0,  placeBudget: 1.0 },
    { id: 'deep',  name: '深度探索', desc: '安排更多地点，步行更多',         stayFactor: 0.85, placeBudget: 1.2 }
  ];

  /* ---------------- 出行方式 ---------------- */
  const TRANSPORTS = [
    { id: 'walk', name: '全程步行' },
    { id: 'mix',  name: '步行 + 地铁' },
    { id: 'bike', name: '步行 + 共享单车' }
  ];

  /* =====================================================================
   * 地点库（南京 · 老城区域）
   * mapX / mapY：示意地图上的相对位置（0-1000 × 0-640），非真实经纬度
   * hours: null 表示「信息待确认」，绝不虚构营业时间
   * ===================================================================== */
  const PLACES = [
    {
      id: 'p_yihe', city: 'nanjing', name: '颐和路民国公馆区', cat: 'arch',
      area: '鼓楼区 · 颐和路', mapX: 300, mapY: 178,
      reason: '梧桐树下的民国公馆群，街道安静、建筑成片，适合慢走与建筑街拍。',
      stay: 35, cost: [0, 0], costNote: '街区免费',
      interests: ['photo', 'history'], themes: ['arch', 'photo'],
      img: IMG.yihc, hours: null, walkFromPrev: null,
      tip: '公馆多为院落，拍照请在公共街道进行。'
    },
    {
      id: 'p_cafe_sh', city: 'nanjing', name: '上海路街角咖啡馆', cat: 'cafe',
      area: '鼓楼区 · 上海路', mapX: 348, mapY: 236,
      reason: '上海路一带咖啡馆密度高，适合在步行中途坐下休息、整理照片。',
      stay: 35, cost: [35, 70], costNote: '人均估算',
      interests: ['coffee'], themes: ['coffee'],
      img: IMG.cafe1, hours: null,
      tip: '具体门店与营业时间需在出行前核验。'
    },
    {
      id: 'p_book_xf', city: 'nanjing', name: '先锋书店（五台山店）', cat: 'book',
      area: '鼓楼区 · 五台山', mapX: 392, mapY: 288,
      reason: '由地下车库改造的城市文化地标书店，适合安排一段安静的阅读时间。',
      stay: 38, cost: [0, 80], costNote: '按消费估算',
      interests: ['book', 'photo'], themes: ['art', 'photo'],
      img: IMG.book1, hours: null,
      tip: '如需购书，预算按实际消费调整。'
    },
    {
      id: 'p_book_tg', city: 'nanjing', name: '陶谷新村旧书店', cat: 'book',
      area: '鼓楼区 · 陶谷新村', mapX: 330, mapY: 332,
      reason: '居民区里的小书店与咖啡铺混杂，是本地文艺街区的日常切片。',
      stay: 30, cost: [0, 50], costNote: '按消费估算',
      interests: ['book', 'local'], themes: ['art'],
      img: IMG.book2, hours: null,
      tip: '小店营业时间不固定，建议出行前确认。'
    },
    {
      id: 'p_xinjiekou', city: 'nanjing', name: '新街口商圈', cat: 'street',
      area: '秦淮区 · 新街口', mapX: 520, mapY: 300,
      reason: '城市中心商业街，适合作为路线的衔接点，感受城市密度与节奏。',
      stay: 30, cost: [0, 100], costNote: '按消费估算',
      interests: ['photo', 'local'], themes: ['arch', 'photo'],
      img: IMG.xinjiekou, hours: null,
      tip: '人流量大，拍摄注意避让行人。'
    },
    {
      id: 'p_changjiang', city: 'nanjing', name: '长江路 · 1912 街区', cat: 'photo',
      area: '玄武区 · 长江路', mapX: 566, mapY: 238,
      reason: '民国建筑立面与夜间灯光形成对比，适合黄昏到入夜时段拍摄。',
      stay: 38, cost: [0, 120], costNote: '按消费估算',
      interests: ['photo', 'history'], themes: ['photo', 'arch'],
      img: IMG.night, hours: null,
      tip: '夜间拍摄建议结伴同行。'
    },
    {
      id: 'p_xuanwu', city: 'nanjing', name: '玄武湖环湖步道', cat: 'park',
      area: '玄武区 · 玄武湖', mapX: 700, mapY: 132,
      reason: '环湖步道视野开阔，是城市里少见的「大面积留白」，适合放慢节奏。',
      stay: 35, cost: [0, 0], costNote: '免费',
      interests: ['park', 'photo'], themes: ['park', 'photo'],
      img: IMG.park2, hours: null,
      tip: '环湖一圈距离较长，可按体力选择段落。'
    },
    {
      id: 'p_qinhuai', city: 'nanjing', name: '夫子庙 · 秦淮河', cat: 'history',
      area: '秦淮区 · 夫子庙', mapX: 620, mapY: 428,
      reason: '河畔老城建筑群集中，沿河步行可看到传统街巷与河岸空间的关系。',
      stay: 35, cost: [0, 100], costNote: '按消费估算',
      interests: ['history', 'photo'], themes: ['history', 'photo'],
      img: IMG.qinhuai, hours: null,
      tip: '节假日人流密集，建议错峰。'
    },
    {
      id: 'p_laomendong', city: 'nanjing', name: '老门东历史文化街区', cat: 'history',
      area: '秦淮区 · 老门东', mapX: 682, mapY: 468,
      reason: '明城墙下的传统街巷，砖木建筑与本地小吃集中，适合边走边看。',
      stay: 38, cost: [0, 60], costNote: '按消费估算',
      interests: ['history', 'local'], themes: ['history', 'art'],
      img: IMG.laomd, hours: null,
      tip: '街区内巷弄较多，注意按地图方向行走。'
    },
    {
      id: 'p_food_ld', city: 'nanjing', name: '老门东本地小馆', cat: 'food',
      area: '秦淮区 · 老门东', mapX: 652, mapY: 498,
      reason: '街区内的本地小吃与简餐，适合作为路线中的一顿正餐或歇脚点。',
      stay: 35, cost: [30, 80], costNote: '人均估算',
      interests: ['local'], themes: ['art'],
      img: IMG.food, hours: null,
      tip: '口味与价格以实际门店为准。'
    },
    {
      id: 'p_bailuzhou', city: 'nanjing', name: '白鹭洲公园', cat: 'park',
      area: '秦淮区 · 白鹭洲', mapX: 742, mapY: 502,
      reason: '秦淮河畔的古典园林，园内步道平缓，适合作为整条路线的收尾。',
      stay: 35, cost: [0, 0], costNote: '免费',
      interests: ['park'], themes: ['park'],
      img: IMG.park1, hours: null,
      tip: '傍晚闭园时间需现场确认。'
    },
    {
      id: 'p_market', city: 'nanjing', name: '城市露台市集', cat: 'photo',
      area: '玄武区 · 城市露台', mapX: 612, mapY: 358,
      reason: '傍晚的露台公共空间，人流与城市天际线同框，适合拍摄城市生活。',
      stay: 30, cost: [0, 60], costNote: '按消费估算',
      interests: ['photo', 'local'], themes: ['photo', 'art'],
      img: IMG.market, hours: null,
      tip: '市集为不定期活动，是否开放需现场确认。'
    }
  ];

  /* =====================================================================
   * 精选路线（发现路线页）
   * ===================================================================== */
  const CURATED_ROUTES = [
    {
      id: 'r_old_town', name: '南京老城慢游计划', city: 'nanjing',
      themes: ['history', 'coffee'], cover: IMG.qinhuai,
      duration: 240, distanceKm: 4.2, budget: [65, 210],
      places: ['p_yihe', 'p_cafe_sh', 'p_book_xf', 'p_laomendong', 'p_bailuzhou'],
      desc: '从民国公馆区走到秦淮河畔，用一下午把建筑、咖啡与老城街巷串成一条线。',
      style: ['慢节奏', '建筑', '咖啡馆', '老城']
    },
    {
      id: 'r_coffee_book', name: '咖啡与书店一日', city: 'nanjing',
      themes: ['coffee', 'art'], cover: IMG.cafe1,
      duration: 180, distanceKm: 3.1, budget: [70, 220],
      places: ['p_cafe_sh', 'p_book_xf', 'p_book_tg', 'p_market'],
      desc: '三家店、两杯咖啡、一段安静阅读时间，适合一个人度过周末下午。',
      style: ['室内为主', '咖啡馆', '书店', '安静']
    },
    {
      id: 'r_republic_arch', name: '民国建筑摄影线', city: 'nanjing',
      themes: ['arch', 'photo'], cover: IMG.yihc,
      duration: 180, distanceKm: 3.6, budget: [20, 140],
      places: ['p_yihe', 'p_changjiang', 'p_xinjiekou', 'p_market'],
      desc: '以建筑立面与街景为线索，从公馆区拍到城市中心的黄昏。',
      style: ['建筑', '摄影', '街拍']
    },
    {
      id: 'r_qinhuai', name: '秦淮河畔历史线', city: 'nanjing',
      themes: ['history'], cover: IMG.laomd,
      duration: 240, distanceKm: 4.6, budget: [40, 180],
      places: ['p_qinhuai', 'p_laomendong', 'p_food_ld', 'p_bailuzhou'],
      desc: '沿秦淮河一线走过河畔街区、老门东巷弄，最后在园林里收尾。',
      style: ['历史文化', '本地小吃', '步行']
    },
    {
      id: 'r_green', name: '公园绿道轻徒步', city: 'nanjing',
      themes: ['park'], cover: IMG.park2,
      duration: 150, distanceKm: 5.0, budget: [0, 60],
      places: ['p_xuanwu', 'p_bailuzhou', 'p_market'],
      desc: '以绿地和开阔空间为主，步行量偏大但节奏轻松，适合只想走路的一天。',
      style: ['公园', '轻徒步', '免费']
    },
    {
      id: 'r_night', name: '城市夜景与市集', city: 'nanjing',
      themes: ['photo'], cover: IMG.night,
      duration: 180, distanceKm: 3.4, budget: [50, 180],
      places: ['p_xinjiekou', 'p_changjiang', 'p_market'],
      desc: '傍晚出发，从商业街走到灯光街区，最后在露台看城市入夜。',
      style: ['夜景', '摄影', '市集']
    }
  ];

  /* ---------------- 地点发现（首页右侧「地点发现」） ---------------- */
  const FEATURED_PLACE_IDS = ['p_laomendong', 'p_cafe_sh', 'p_book_xf', 'p_xuanwu', 'p_yihe', 'p_qinhuai'];

  CW.data = {
    IMG, CATEGORIES, CITIES, THEMES, INTERESTS, PACES, TRANSPORTS,
    PLACES, CURATED_ROUTES, FEATURED_PLACE_IDS,

    /* ---- 查询工具 ---- */
    city: id => CITIES.find(c => c.id === id),
    place: id => PLACES.find(p => p.id === id),
    places: ids => ids.map(id => PLACES.find(p => p.id === id)).filter(Boolean),
    route: id => CURATED_ROUTES.find(r => r.id === id),
    cat: id => CATEGORIES[id] || { name: '未分类', color: '#8D968E' },
    interest: id => INTERESTS.find(i => i.id === id),
    theme: id => THEMES.find(t => t.id === id),
    placesOfCity: cityId => PLACES.filter(p => p.city === cityId),
    routesOfCity: cityId => CURATED_ROUTES.filter(r => r.city === cityId),

    /* 估算：步行分钟 → 公里（按 4.5km/h 折算，仅用于展示） */
    minutesToKm: min => Math.round((min / 60) * 4.5 * 10) / 10,

    /* 数据可信度提示文案（统一出口，避免各处口径不一致） */
    DISCLAIMER: {
      sample: '示例数据 · 非真实导航结果',
      estimate: '时长、距离与费用均为估算值',
      hours: '营业信息待确认',
      map: '示意地图 · 不含真实坐标'
    }
  };
})();
