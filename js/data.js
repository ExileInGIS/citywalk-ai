/* =====================================================================
 * data.js · 数据层
 * ---------------------------------------------------------------------
 * ⚠️ 数据来源说明（重要）
 *  - 南京 67 个地点：名称/坐标来自 OpenStreetMap（ODbL 1.0）；部分照片来自高德 POI（非商业自用）。
 *  - 停留时长、消费区间、步行耗时、距离 均为【产品估算值】。
 *  - 营业时间仅在可核验时填写，否则保持 null → 界面显示「信息待确认」。
 *  - 地图为示意地图；坐标不是导航入口/门牌，不能当作真实导航结果。
 *  - 真实部署前仍需逐点核验营业状态、门票与照片授权。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CW = root.CW || {};
    root.CW.data = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

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
    "id": "p_yihe",
    "city": "nanjing",
    "name": "颐和路民国公馆区",
    "cat": "arch",
    "area": "鼓楼区 · 颐和路",
    "mapX": 300,
    "mapY": 178,
    "reason": "梧桐树下的民国公馆群，街道安静、建筑成片，适合慢走与建筑街拍。",
    "stay": 35,
    "cost": [
      0,
      0
    ],
    "costNote": "街区免费",
    "interests": [
      "photo",
      "history"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/yihc.jpg",
    "hours": null,
    "walkFromPrev": null,
    "tip": "公馆多为院落，拍照请在公共街道进行。",
    "lat": 32.0652918,
    "lng": 118.7614006,
    "geoStatus": "verified",
    "geoConfidence": "high",
    "geoSource": "OpenStreetMap way/89567586",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": false
  },
  {
    "id": "p_book_xf",
    "city": "nanjing",
    "name": "先锋书店（五台山店）",
    "cat": "book",
    "area": "鼓楼区 · 五台山",
    "mapX": 392,
    "mapY": 288,
    "reason": "由地下车库改造的城市文化地标书店，适合安排一段安静的阅读时间。",
    "stay": 38,
    "cost": [
      0,
      80
    ],
    "costNote": "按消费估算",
    "interests": [
      "book",
      "photo"
    ],
    "themes": [
      "art",
      "photo"
    ],
    "img": "assets/img/book1.jpg",
    "hours": null,
    "tip": "如需购书，预算按实际消费调整。",
    "lat": 32.0527745,
    "lng": 118.7682621,
    "geoStatus": "verified",
    "geoConfidence": "medium",
    "geoSource": "OpenStreetMap node/6331495101",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": true
  },
  {
    "id": "p_xinjiekou",
    "city": "nanjing",
    "name": "新街口商圈",
    "cat": "street",
    "area": "秦淮区 · 新街口",
    "mapX": 520,
    "mapY": 300,
    "reason": "城市中心商业街，适合作为路线的衔接点，感受城市密度与节奏。",
    "stay": 30,
    "cost": [
      0,
      100
    ],
    "costNote": "按消费估算",
    "interests": [
      "photo",
      "local"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/xinjiekou.jpg",
    "hours": null,
    "tip": "人流量大，拍摄注意避让行人。",
    "lat": 32.0438303,
    "lng": 118.7788612,
    "geoStatus": "verified",
    "geoConfidence": "high",
    "geoSource": "OpenStreetMap way/155883034",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": false
  },
  {
    "id": "p_changjiang",
    "city": "nanjing",
    "name": "长江路 · 1912 街区",
    "cat": "photo",
    "area": "玄武区 · 长江路",
    "mapX": 566,
    "mapY": 238,
    "reason": "民国建筑立面与夜间灯光形成对比，适合黄昏到入夜时段拍摄。",
    "stay": 38,
    "cost": [
      0,
      120
    ],
    "costNote": "按消费估算",
    "interests": [
      "photo",
      "history"
    ],
    "themes": [
      "photo",
      "arch"
    ],
    "img": "assets/img/night.jpg",
    "hours": null,
    "tip": "夜间拍摄建议结伴同行。",
    "lat": 32.0467613,
    "lng": 118.7905898,
    "geoStatus": "verified",
    "geoConfidence": "high",
    "geoSource": "OpenStreetMap way/857492847",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": false
  },
  {
    "id": "p_xuanwu",
    "city": "nanjing",
    "name": "玄武湖环湖步道",
    "cat": "park",
    "area": "玄武区 · 玄武湖",
    "mapX": 700,
    "mapY": 132,
    "reason": "环湖步道视野开阔，是城市里少见的「大面积留白」，适合放慢节奏。",
    "stay": 35,
    "cost": [
      0,
      0
    ],
    "costNote": "免费",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park",
      "photo"
    ],
    "img": "assets/img/park2.jpg",
    "hours": null,
    "tip": "环湖一圈距离较长，可按体力选择段落。",
    "lat": 32.0744113,
    "lng": 118.795514,
    "geoStatus": "verified",
    "geoConfidence": "medium",
    "geoSource": "OpenStreetMap relation/2138994",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": false
  },
  {
    "id": "p_qinhuai",
    "city": "nanjing",
    "name": "夫子庙 · 秦淮河",
    "cat": "history",
    "area": "秦淮区 · 夫子庙",
    "mapX": 620,
    "mapY": 428,
    "reason": "河畔老城建筑群集中，沿河步行可看到传统街巷与河岸空间的关系。",
    "stay": 35,
    "cost": [
      0,
      100
    ],
    "costNote": "按消费估算",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history",
      "photo"
    ],
    "img": "assets/img/qinhuai.jpg",
    "hours": null,
    "tip": "节假日人流密集，建议错峰。",
    "lat": 32.0204106,
    "lng": 118.7827931,
    "geoStatus": "verified",
    "geoConfidence": "medium",
    "geoSource": "OpenStreetMap way/590937998",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": false
  },
  {
    "id": "p_laomendong",
    "city": "nanjing",
    "name": "老门东历史文化街区",
    "cat": "history",
    "area": "秦淮区 · 老门东",
    "mapX": 682,
    "mapY": 468,
    "reason": "明城墙下的传统街巷，砖木建筑与本地小吃集中，适合边走边看。",
    "stay": 38,
    "cost": [
      0,
      60
    ],
    "costNote": "按消费估算",
    "interests": [
      "history",
      "local"
    ],
    "themes": [
      "history",
      "art"
    ],
    "img": "assets/img/laomd.jpg",
    "hours": null,
    "tip": "街区内巷弄较多，注意按地图方向行走。",
    "lat": 32.013464,
    "lng": 118.7822575,
    "geoStatus": "verified",
    "geoConfidence": "high",
    "geoSource": "OpenStreetMap way/948332291",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": false
  },
  {
    "id": "p_bailuzhou",
    "city": "nanjing",
    "name": "白鹭洲公园",
    "cat": "park",
    "area": "秦淮区 · 白鹭洲",
    "mapX": 742,
    "mapY": 502,
    "reason": "秦淮河畔的古典园林，园内步道平缓，适合作为整条路线的收尾。",
    "stay": 35,
    "cost": [
      0,
      0
    ],
    "costNote": "免费",
    "interests": [
      "park"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "hours": null,
    "tip": "傍晚闭园时间需现场确认。",
    "lat": 32.0194287,
    "lng": 118.7897433,
    "geoStatus": "verified-coordinate-only",
    "geoConfidence": "high",
    "geoSource": "OpenStreetMap way/88807020",
    "geoLicense": "ODbL 1.0 © OpenStreetMap contributors",
    "geoVerified": true,
    "indoor": false
  },
  {
    "id": "p_cafe_zw",
    "city": "nanjing",
    "name": "南京植物咖啡馆",
    "cat": "cafe",
    "area": "鼓楼区 · 慈悲社",
    "reason": "慈悲社里的独立咖啡馆，适合在颐和路/上海路一带步行中途休息。",
    "stay": 40,
    "cost": [
      35,
      70
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "coffee"
    ],
    "themes": [
      "coffee"
    ],
    "img": "assets/img/cafe1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "座位与营业时间以现场为准。",
    "mapX": 480,
    "mapY": 286
  },
  {
    "id": "p_book_dz",
    "city": "nanjing",
    "name": "大众书局",
    "cat": "book",
    "area": "秦淮区 · 新街口",
    "reason": "新街口附近的书店，适合在商圈步行中停留选书。",
    "stay": 40,
    "cost": [
      0,
      80
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "book"
    ],
    "themes": [
      "art"
    ],
    "img": "assets/img/book1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "营业时间与店内规则以现场为准。",
    "mapX": 504,
    "mapY": 304
  },
  {
    "id": "p_food_wl",
    "city": "nanjing",
    "name": "问柳菜馆",
    "cat": "food",
    "area": "秦淮区 · 老门东",
    "reason": "老门东箍桶巷的本地菜馆，适合安排一顿正餐。",
    "stay": 55,
    "cost": [
      60,
      120
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "local"
    ],
    "themes": [
      "art"
    ],
    "img": "https://aos-comment.amap.com/B0FFF5P4QZ/comment/f640884a1c29d9a040183961d52142eb_2048_2048_80.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "菜单、人均与排队情况以现场为准。",
    "mapX": 644,
    "mapY": 486
  },
  {
    "id": "p_nanjing_eye",
    "city": "nanjing",
    "name": "南京眼步行桥",
    "cat": "photo",
    "area": "建邺区 · 河西",
    "reason": "河西青奥轴线上的步行桥，适合傍晚看江景与城市天际线。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "photo"
    ],
    "themes": [
      "photo"
    ],
    "img": "https://aos-comment.amap.com/BY00004EC5/comment/247B0DB1_25A4_443C_BAE0_8F2BE7573E8C_L0_001_1500_200_1771051098684_85318209.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "桥面开放情况与夜景灯光以现场为准。",
    "mapX": 30,
    "mapY": 610
  },
  {
    "id": "p_zhongshanling",
    "city": "nanjing",
    "name": "中山陵",
    "cat": "history",
    "area": "玄武区 · 紫金山",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 90,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://store.is.autonavi.com/showpic/e14516c013e0d5f8e4481ddfd66a262a",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 970,
    "mapY": 179
  },
  {
    "id": "p_mingxiaoling",
    "city": "nanjing",
    "name": "明孝陵",
    "cat": "history",
    "area": "玄武区 · 紫金山",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 90,
    "cost": [
      60,
      90
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://store.is.autonavi.com/showpic/aee2b6bfb92ad7340000002976032815?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 970,
    "mapY": 173
  },
  {
    "id": "p_nanjing_museum",
    "city": "nanjing",
    "name": "南京博物院",
    "cat": "history",
    "area": "玄武区 · 中山东路",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 120,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周一 闭馆(法定节假日除外)；周二至周日 09:00-17:00开放(16:00停止入园)",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 970,
    "mapY": 298
  },
  {
    "id": "p_presidential_palace",
    "city": "nanjing",
    "name": "总统府",
    "cat": "history",
    "area": "玄武区 · 长江路",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 90,
    "cost": [
      35,
      40
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "08:30-18:00（17:00停止入场，周一闭馆）(数据来源:江苏省文旅厅公共服务平台苏心游)",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 679,
    "mapY": 288
  },
  {
    "id": "p_six_dynasties",
    "city": "nanjing",
    "name": "六朝博物馆",
    "cat": "history",
    "area": "玄武区 · 长江路",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      30,
      30
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周二至周日 09:00-17:30",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 705,
    "mapY": 295
  },
  {
    "id": "p_jiangning_weaving",
    "city": "nanjing",
    "name": "江宁织造博物馆",
    "cat": "history",
    "area": "秦淮区 · 长江路",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      30,
      30
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://store.is.autonavi.com/showpic/bb8cdb6e6d186e660000003043840263?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周二至周日09:00-17:30(17:00停止入馆),周一闭馆（法定节假日正常开放） 5月18日国际博物馆日9:00-17:30开放(17:30停止入馆),(数据来源:江苏省文旅厅公共服务平台苏心游)",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 646,
    "mapY": 298
  },
  {
    "id": "p_folk_museum",
    "city": "nanjing",
    "name": "南京市民俗博物馆",
    "cat": "history",
    "area": "秦淮区 · 南捕厅",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      20,
      30
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://store.is.autonavi.com/showpic/0311ed51bf264f530000003134924288?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "01-01至06-17 周一 全天关闭；01-01至09-23 周二至周四,周日 09:00-17:30 最晚进入17:00；01-01至09-23 周五至周六 09:00-21:00 最晚进入20:30；06-18至08-31 周一 09:00-17:30 最晚进入17:00；09-01至09-23 周一 全天关闭；09-24至09-24 周一至周日 09:00-21:00 最晚进入20:30；09-25至09-26 周一至周日 08:30-21:00 最晚进入20:30；09-27至09-27 周一至周日 08:30-18:00 最晚进入17:30；09-28至09-30 周一 全天关闭；09-28至09-30 周二至周四,周日 09:00-17:30 最晚进入17:00；09-28至09-30 周五至周六 09:00-21:00 最晚进入20:30；10-01至10-06 周一至周日 08:30-21:00 最晚进入20:30；10-07至10-07 周一至周日 08:30-18:00 最晚进入17:30；10-08至12-31 周一 全天关闭；10-08至12-31 周二至周四,周日 09:00-17:30 最晚进入17:00；10-08至12-31 周五至周六 09:00-21:00 最晚进入20:30；日场09:00-17:30（17:00停止售票），夜场:周五周六17:00-21:00（20:30停止售票） 节假日日场08:30-18:00（17:30停止售票），夜场:周五周六17:30-21:00（20:30停止售票）",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 547,
    "mapY": 404
  },
  {
    "id": "p_zhanyuan",
    "city": "nanjing",
    "name": "瞻园",
    "cat": "history",
    "area": "秦淮区 · 瞻园路",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      30,
      40
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周二至周日:08:30-17:00,每周一闭园；具体营业时间以官方通知为准",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 597,
    "mapY": 430
  },
  {
    "id": "p_jiangnan_exam",
    "city": "nanjing",
    "name": "江南贡院",
    "cat": "history",
    "area": "秦淮区 · 夫子庙",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      50,
      50
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://aos-comment.amap.com/B0FFL4EUBJ/comment/87e2c86123ddcf998c7fa8d3ff6933b1_2048_2048_80.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 658,
    "mapY": 428
  },
  {
    "id": "p_wuyi_lane",
    "city": "nanjing",
    "name": "乌衣巷",
    "cat": "street",
    "area": "秦淮区 · 夫子庙",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 25,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://aos-comment.amap.com/BZAPQF03AG/comment/content_media_external_images_media_547496_ss__1730768521894_53266362.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 671,
    "mapY": 447
  },
  {
    "id": "p_city_wall_museum",
    "city": "nanjing",
    "name": "南京城墙博物馆",
    "cat": "history",
    "area": "秦淮区 · 中华门",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://store.is.autonavi.com/showpic/8eff7696f783cd4d0000002744874537?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周二至周日 09:00-17:00 最晚进入16:30",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 591,
    "mapY": 482
  },
  {
    "id": "p_zhonghuamen",
    "city": "nanjing",
    "name": "中华门",
    "cat": "history",
    "area": "秦淮区 · 中华门",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 50,
    "cost": [
      50,
      50
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周一至周日 08:30-22:00；具体营业状态以当天开放情况为准。",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 577,
    "mapY": 483
  },
  {
    "id": "p_yuhuatai",
    "city": "nanjing",
    "name": "雨花台风景名胜区",
    "cat": "history",
    "area": "雨花台区 · 雨花台",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 90,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 628,
    "mapY": 565
  },
  {
    "id": "p_dabaoensi",
    "city": "nanjing",
    "name": "大报恩寺遗址博物馆",
    "cat": "history",
    "area": "秦淮区 · 雨花路",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      80,
      120
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://store.is.autonavi.com/showpic/9e129476a7214dc80000003167474542?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "08:30-20:15（19:30停止售票，19:30停止入园）(数据来源:江苏省文旅厅公共服务平台苏心游)",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 605,
    "mapY": 501
  },
  {
    "id": "p_jiming_temple",
    "city": "nanjing",
    "name": "鸡鸣寺",
    "cat": "history",
    "area": "玄武区 · 鸡鸣寺",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 45,
    "cost": [
      10,
      10
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://aos-comment.amap.com/B001917UAU/comment/content_media_external_file_1000083848_ss__1768533772122_42745544.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 613,
    "mapY": 188
  },
  {
    "id": "p_taicheng",
    "city": "nanjing",
    "name": "台城",
    "cat": "history",
    "area": "玄武区 · 玄武湖",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 40,
    "cost": [
      15,
      30
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 615,
    "mapY": 183
  },
  {
    "id": "p_yuejianglou",
    "city": "nanjing",
    "name": "阅江楼",
    "cat": "arch",
    "area": "鼓楼区 · 下关",
    "reason": "建筑与街区观察点位，适合拍照与步行。",
    "stay": 60,
    "cost": [
      40,
      40
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://aos-comment.amap.com/B0FFFDRUH8/comment/fc53d79db58b9b93808deb3853487281_2048_2048_80.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "校园/街区进入规则以现场公告为准。",
    "mapX": 30,
    "mapY": 30
  },
  {
    "id": "p_jinghaisi",
    "city": "nanjing",
    "name": "静海寺",
    "cat": "history",
    "area": "鼓楼区 · 下关",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 40,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 30,
    "mapY": 30
  },
  {
    "id": "p_tianfeigong",
    "city": "nanjing",
    "name": "天妃宫",
    "cat": "history",
    "area": "鼓楼区 · 下关",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://aos-comment.amap.com/B001908LX4/comment/content_media_external_file_1000007520_ss__1767169362913_16600968.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周一至周日 08:00-17:00",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 30,
    "mapY": 30
  },
  {
    "id": "p_chaotiangong",
    "city": "nanjing",
    "name": "朝天宫",
    "cat": "history",
    "area": "秦淮区 · 朝天宫",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      25,
      25
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周一全天关闭(法定节假日正常开放),周二至周日:09:00-18:00(17:00停止售票),2026年2月1日至2026年3月3日周一正常开放",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 457,
    "mapY": 354
  },
  {
    "id": "p_nju",
    "city": "nanjing",
    "name": "南京大学（鼓楼校区）",
    "cat": "arch",
    "area": "鼓楼区 · 鼓楼",
    "reason": "建筑与街区观察点位，适合拍照与步行。",
    "stay": 40,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://store.is.autonavi.com/showpic/6380abaf2532090f0000002978268138?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "校园/街区进入规则以现场公告为准。",
    "mapX": 452,
    "mapY": 233
  },
  {
    "id": "p_seu",
    "city": "nanjing",
    "name": "东南大学（四牌楼校区）",
    "cat": "arch",
    "area": "玄武区 · 四牌楼",
    "reason": "建筑与街区观察点位，适合拍照与步行。",
    "stay": 40,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/yihc.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "校园/街区进入规则以现场公告为准。",
    "mapX": 608,
    "mapY": 221
  },
  {
    "id": "p_njnu",
    "city": "nanjing",
    "name": "南京师范大学（随园校区）",
    "cat": "arch",
    "area": "鼓楼区 · 随园",
    "reason": "建筑与街区观察点位，适合拍照与步行。",
    "stay": 40,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/yihc.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "校园/街区进入规则以现场公告为准。",
    "mapX": 322,
    "mapY": 248
  },
  {
    "id": "p_nanjing_library",
    "city": "nanjing",
    "name": "南京图书馆",
    "cat": "arch",
    "area": "玄武区 · 大行宫",
    "reason": "建筑与街区观察点位，适合拍照与步行。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/yihc.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周一全天关闭，周二至周日 09:00-17:30，节假日营业时间以官方通知为准",
    "walkFromPrev": null,
    "tip": "校园/街区进入规则以现场公告为准。",
    "mapX": 664,
    "mapY": 300
  },
  {
    "id": "p_jiangsu_art_museum",
    "city": "nanjing",
    "name": "江苏省美术馆",
    "cat": "arch",
    "area": "玄武区 · 长江路",
    "reason": "建筑与街区观察点位，适合拍照与步行。",
    "stay": 45,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://aos-comment.amap.com/B00190D1I8/comment/content_media_external_file_116029_ss__1771478710907_09039225.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周二至周日09:00-17:00(16:30 停止入馆),周一闭馆（法定节假日除外),(数据来源:江苏省文旅厅公共服务平台苏心游)",
    "walkFromPrev": null,
    "tip": "校园/街区进入规则以现场公告为准。",
    "mapX": 700,
    "mapY": 303
  },
  {
    "id": "p_yunjin_museum",
    "city": "nanjing",
    "name": "南京云锦博物馆",
    "cat": "history",
    "area": "建邺区 · 茶亭",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 45,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 110,
    "mapY": 357
  },
  {
    "id": "p_paleontology_museum",
    "city": "nanjing",
    "name": "南京古生物博物馆",
    "cat": "history",
    "area": "玄武区 · 鸡鸣寺",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      20,
      30
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周一至周二 全天关闭；周三至周日 09:00-17:00 最晚进入16:00；每周一、周二闭馆（法定节假日开放安排以官方公告为准）",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 619,
    "mapY": 196
  },
  {
    "id": "p_geology_museum",
    "city": "nanjing",
    "name": "南京地质博物馆",
    "cat": "history",
    "area": "玄武区 · 珠江路",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 45,
    "cost": [
      0,
      20
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://aos-comment.amap.com/B00190BD4M/comment/content_media_external_file_1000021094_ss__1762588499032_06660535.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周三至周五:09:30-16:30(16:00停止入馆),周六至周日:09:00-16:30(16:00停止入馆)；周一、周二闭馆,法定节假日开放时间另行通知；节假日营业时间以官方通知为准",
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 787,
    "mapY": 280
  },
  {
    "id": "p_crossing_memorial",
    "city": "nanjing",
    "name": "渡江胜利纪念馆",
    "cat": "history",
    "area": "鼓楼区 · 三汊河",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 60,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "assets/img/laomd.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 30,
    "mapY": 140
  },
  {
    "id": "p_meiyuan",
    "city": "nanjing",
    "name": "梅园新村纪念馆",
    "cat": "history",
    "area": "玄武区 · 梅园新村",
    "reason": "南京历史文化点位，适合步行参观与城市观察。",
    "stay": 45,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "history",
      "photo"
    ],
    "themes": [
      "history"
    ],
    "img": "https://store.is.autonavi.com/showpic/4d7a89b05e0157190000004692278846",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间、门票以现场或官方公告为准。",
    "mapX": 729,
    "mapY": 292
  },
  {
    "id": "p_mochou_lake",
    "city": "nanjing",
    "name": "莫愁湖公园",
    "cat": "park",
    "area": "建邺区 · 莫愁湖",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 60,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "5月至9月周二至周日:06:00-21:00；1月至4月,10月至12月07:00-21:00；主景区开放时间:华严庵、胜棋楼、莫愁女故居、莫愁水院、棋文馆、家具馆08:30-17:00(除法定节假日,),2026年2月15日-2026年2月23日07:00-21:00,2026年2月15日-2026年2月23日07:00-21:00",
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 304,
    "mapY": 357
  },
  {
    "id": "p_qingliangshan",
    "city": "nanjing",
    "name": "清凉山公园",
    "cat": "park",
    "area": "鼓楼区 · 清凉山",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 45,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周一至周日 06:00-18:00",
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 255,
    "mapY": 268
  },
  {
    "id": "p_gulin_park",
    "city": "nanjing",
    "name": "古林公园",
    "cat": "park",
    "area": "鼓楼区 · 古林",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 45,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "https://store.is.autonavi.com/showpic/5827ccd80c0892dc0000002739980978?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周一至周日 06:30-20:00",
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 135,
    "mapY": 173
  },
  {
    "id": "p_guofang_park",
    "city": "nanjing",
    "name": "国防园",
    "cat": "park",
    "area": "鼓楼区 · 清凉门",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 45,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 188,
    "mapY": 267
  },
  {
    "id": "p_jiuhuashan",
    "city": "nanjing",
    "name": "九华山公园",
    "cat": "park",
    "area": "玄武区 · 九华山",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 40,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "周一至周日 09:00-18:00",
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 766,
    "mapY": 191
  },
  {
    "id": "p_qinglv_park",
    "city": "nanjing",
    "name": "情侣园",
    "cat": "park",
    "area": "玄武区 · 玄武湖",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 45,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 762,
    "mapY": 127
  },
  {
    "id": "p_baima_park",
    "city": "nanjing",
    "name": "白马公园",
    "cat": "park",
    "area": "玄武区 · 太平门",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 40,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": "1月至2月,12月 周一至周日 06:00-21:00；3月至11月 周一至周日 06:00-22:00",
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 855,
    "mapY": 177
  },
  {
    "id": "p_botanical_garden",
    "city": "nanjing",
    "name": "中山植物园",
    "cat": "park",
    "area": "玄武区 · 紫金山",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 60,
    "cost": [
      15,
      45
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "https://aos-comment.amap.com/B0FFHLP8ZQ/comment/97b8330e7e16be51d58c38f169eb0df9_2048_2048_80.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 970,
    "mapY": 203
  },
  {
    "id": "p_yueya_lake",
    "city": "nanjing",
    "name": "月牙湖",
    "cat": "park",
    "area": "秦淮区 · 月牙湖",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "https://store.is.autonavi.com/showpic/54c0e0ea68e5e73a5eceee91c04fdc03",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 970,
    "mapY": 362
  },
  {
    "id": "p_wulongtan",
    "city": "nanjing",
    "name": "乌龙潭公园",
    "cat": "park",
    "area": "鼓楼区 · 乌龙潭",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "https://aos-comment.amap.com/B001905179/comment/content_media_external_file_652_1749178288728_44625563.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周一至周日 06:00-21:30",
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 322,
    "mapY": 291
  },
  {
    "id": "p_xiaotaoyuan",
    "city": "nanjing",
    "name": "小桃园",
    "cat": "park",
    "area": "鼓楼区 · 小桃园",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 30,
    "mapY": 93
  },
  {
    "id": "p_pipa_lake",
    "city": "nanjing",
    "name": "琵琶湖",
    "cat": "park",
    "area": "玄武区 · 紫金山",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "https://store.is.autonavi.com/showpic/7739ff97f802e28e0000002884142462?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 935,
    "mapY": 221
  },
  {
    "id": "p_qianhu",
    "city": "nanjing",
    "name": "前湖",
    "cat": "park",
    "area": "玄武区 · 紫金山",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "https://store.is.autonavi.com/showpic/c7f614dd1f66a1800000000699702927?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 970,
    "mapY": 248
  },
  {
    "id": "p_meihua_mountain",
    "city": "nanjing",
    "name": "梅花山",
    "cat": "park",
    "area": "玄武区 · 紫金山",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 45,
    "cost": [
      0,
      70
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 970,
    "mapY": 211
  },
  {
    "id": "p_stone_city",
    "city": "nanjing",
    "name": "石头城",
    "cat": "park",
    "area": "鼓楼区 · 石头城",
    "reason": "城市公园/绿地，适合散步、休息与拍照。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "park",
      "photo"
    ],
    "themes": [
      "park"
    ],
    "img": "assets/img/park1.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "开放时间与临时封闭以现场公告为准。",
    "mapX": 167,
    "mapY": 269
  },
  {
    "id": "p_hunan_road",
    "city": "nanjing",
    "name": "湖南路",
    "cat": "street",
    "area": "鼓楼区 · 湖南路",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 35,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/xinjiekou.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 435,
    "mapY": 145
  },
  {
    "id": "p_shiziqiao",
    "city": "nanjing",
    "name": "狮子桥步行街",
    "cat": "street",
    "area": "鼓楼区 · 湖南路",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 45,
    "cost": [
      30,
      80
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/xinjiekou.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 405,
    "mapY": 156
  },
  {
    "id": "p_sanqiba_lane",
    "city": "nanjing",
    "name": "三七八巷",
    "cat": "street",
    "area": "秦淮区 · 三七八巷",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://aos-comment.amap.com/B00190BP4A/comment/content_media_external_file_42682_ss__1749424927146_90963334.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 676,
    "mapY": 461
  },
  {
    "id": "p_kexiang",
    "city": "nanjing",
    "name": "科巷",
    "cat": "street",
    "area": "秦淮区 · 科巷",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 35,
    "cost": [
      30,
      80
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://aos-comment.amap.com/B0IA3MP3IP/comment/58bdf6e8a5797c8dd956ef7ad6d43ced_2048_2048_80.jpg",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 679,
    "mapY": 317
  },
  {
    "id": "p_pingshi_street",
    "city": "nanjing",
    "name": "评事街",
    "cat": "street",
    "area": "秦淮区 · 评事街",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 25,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://store.is.autonavi.com/showpic/603166487947de7ee0cea4f901f0f7b2",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 521,
    "mapY": 376
  },
  {
    "id": "p_xinanli",
    "city": "nanjing",
    "name": "熙南里文化街区",
    "cat": "street",
    "area": "秦淮区 · 熙南里",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 40,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://store.is.autonavi.com/showpic/53b135e8afb00d970000002655930403?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 545,
    "mapY": 409
  },
  {
    "id": "p_deji_plaza",
    "city": "nanjing",
    "name": "德基广场",
    "cat": "street",
    "area": "玄武区 · 新街口",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 45,
    "cost": [
      0,
      200
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/xinjiekou.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 542,
    "mapY": 299
  },
  {
    "id": "p_golden_eagle",
    "city": "nanjing",
    "name": "金鹰国际购物中心",
    "cat": "street",
    "area": "秦淮区 · 新街口",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 45,
    "cost": [
      0,
      200
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "assets/img/xinjiekou.jpg",
    "imgSource": "本地类别示意图片",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 520,
    "mapY": 252
  },
  {
    "id": "p_hongmiao",
    "city": "nanjing",
    "name": "红庙",
    "cat": "street",
    "area": "秦淮区 · 红庙",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 30,
    "cost": [
      30,
      80
    ],
    "costNote": "人均/门票为产品估算，以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://store.is.autonavi.com/showpic/baff85e558bd5bb10000003437338249?type=pic",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": "周一至周日 07:00-18:00",
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 591,
    "mapY": 270
  },
  {
    "id": "p_xiaoxihu",
    "city": "nanjing",
    "name": "小西湖",
    "cat": "street",
    "area": "秦淮区 · 小西湖",
    "reason": "街区/商业街，适合边走边看与本地体验。",
    "stay": 30,
    "cost": [
      0,
      0
    ],
    "costNote": "公共空间免费；特殊活动以现场为准",
    "interests": [
      "local",
      "photo"
    ],
    "themes": [
      "arch",
      "photo"
    ],
    "img": "https://store.is.autonavi.com/showpic/85b826767487f243c6242a7d51a39936",
    "imgSource": "高德地图 POI 图片（非商业自用）",
    "hours": null,
    "walkFromPrev": null,
    "tip": "店铺营业与街区活动以现场为准。",
    "mapX": 631,
    "mapY": 460
  }
];

  /* =====================================================================
   * 精选路线（发现路线页）
   * ===================================================================== */
  const CURATED_ROUTES = [
  {
    "id": "r_old_town",
    "name": "南京老城慢游计划",
    "city": "nanjing",
    "themes": [
      "history",
      "coffee"
    ],
    "cover": "assets/img/qinhuai.jpg",
    "duration": 240,
    "distanceKm": 4.2,
    "budget": [
      65,
      210
    ],
    "places": [
      "p_yihe",
      "p_cafe_zw",
      "p_book_xf",
      "p_laomendong",
      "p_bailuzhou"
    ],
    "desc": "从民国公馆区走到秦淮河畔，用一下午把建筑、咖啡与老城街巷串成一条线。",
    "style": [
      "慢节奏",
      "建筑",
      "咖啡馆",
      "老城"
    ]
  },
  {
    "id": "r_coffee_book",
    "name": "咖啡与书店一日",
    "city": "nanjing",
    "themes": [
      "coffee",
      "art"
    ],
    "cover": "assets/img/cafe1.jpg",
    "duration": 180,
    "distanceKm": 3.1,
    "budget": [
      70,
      220
    ],
    "places": [
      "p_cafe_zw",
      "p_book_xf",
      "p_book_dz",
      "p_nanjing_eye"
    ],
    "desc": "三家店、两杯咖啡、一段安静阅读时间，适合一个人度过周末下午。",
    "style": [
      "室内为主",
      "咖啡馆",
      "书店",
      "安静"
    ]
  },
  {
    "id": "r_republic_arch",
    "name": "民国建筑摄影线",
    "city": "nanjing",
    "themes": [
      "arch",
      "photo"
    ],
    "cover": "assets/img/yihc.jpg",
    "duration": 180,
    "distanceKm": 3.6,
    "budget": [
      20,
      140
    ],
    "places": [
      "p_yihe",
      "p_changjiang",
      "p_xinjiekou",
      "p_nanjing_eye"
    ],
    "desc": "以建筑立面与街景为线索，从公馆区拍到城市中心的黄昏。",
    "style": [
      "建筑",
      "摄影",
      "街拍"
    ]
  },
  {
    "id": "r_qinhuai",
    "name": "秦淮河畔历史线",
    "city": "nanjing",
    "themes": [
      "history"
    ],
    "cover": "assets/img/laomd.jpg",
    "duration": 240,
    "distanceKm": 4.6,
    "budget": [
      40,
      180
    ],
    "places": [
      "p_qinhuai",
      "p_laomendong",
      "p_food_wl",
      "p_bailuzhou"
    ],
    "desc": "沿秦淮河一线走过河畔街区、老门东巷弄，最后在园林里收尾。",
    "style": [
      "历史文化",
      "本地小吃",
      "步行"
    ]
  },
  {
    "id": "r_green",
    "name": "公园绿道轻徒步",
    "city": "nanjing",
    "themes": [
      "park"
    ],
    "cover": "assets/img/park2.jpg",
    "duration": 150,
    "distanceKm": 5,
    "budget": [
      0,
      60
    ],
    "places": [
      "p_xuanwu",
      "p_bailuzhou",
      "p_nanjing_eye"
    ],
    "desc": "以绿地和开阔空间为主，步行量偏大但节奏轻松，适合只想走路的一天。",
    "style": [
      "公园",
      "轻徒步",
      "免费"
    ]
  },
  {
    "id": "r_night",
    "name": "城市夜景与市集",
    "city": "nanjing",
    "themes": [
      "photo"
    ],
    "cover": "assets/img/night.jpg",
    "duration": 180,
    "distanceKm": 3.4,
    "budget": [
      50,
      180
    ],
    "places": [
      "p_xinjiekou",
      "p_changjiang",
      "p_nanjing_eye"
    ],
    "desc": "傍晚出发，从商业街走到灯光街区，最后在露台看城市入夜。",
    "style": [
      "夜景",
      "摄影",
      "市集"
    ]
  }
];

  /* ---------------- 地点发现（首页右侧「地点发现」） ---------------- */
  const FEATURED_PLACE_IDS = ["p_laomendong","p_cafe_zw","p_book_xf","p_xuanwu","p_yihe","p_qinhuai"];

  /* =====================================================================
   * 真实坐标（OpenStreetMap，ODbL 1.0）
   * ---------------------------------------------------------------------
   * 只有能在 OSM 找到确定对象的点才有坐标；泛化/示例地点保持 null。
   * 坐标不等于“入口”或“门牌”：湖面/公园面/道路的坐标是对象中心点。
   * 浏览器 Leaflet Provider 与 Node 服务端共用这份数据。
   * ===================================================================== */
  const GEO = {
  "p_yihe": {
    "lat": 32.0652918,
    "lon": 118.7614006,
    "osmType": "way",
    "osmId": 89567586,
    "confidence": "high",
    "status": "verified"
  },
  "p_book_xf": {
    "lat": 32.0527745,
    "lon": 118.7682621,
    "osmType": "node",
    "osmId": 6331495101,
    "confidence": "medium",
    "status": "verified"
  },
  "p_xinjiekou": {
    "lat": 32.0438303,
    "lon": 118.7788612,
    "osmType": "way",
    "osmId": 155883034,
    "confidence": "high",
    "status": "verified"
  },
  "p_changjiang": {
    "lat": 32.0467613,
    "lon": 118.7905898,
    "osmType": "way",
    "osmId": 857492847,
    "confidence": "high",
    "status": "verified"
  },
  "p_xuanwu": {
    "lat": 32.0744113,
    "lon": 118.795514,
    "osmType": "relation",
    "osmId": 2138994,
    "confidence": "medium",
    "status": "verified"
  },
  "p_qinhuai": {
    "lat": 32.0204106,
    "lon": 118.7827931,
    "osmType": "way",
    "osmId": 590937998,
    "confidence": "medium",
    "status": "verified"
  },
  "p_laomendong": {
    "lat": 32.013464,
    "lon": 118.7822575,
    "osmType": "way",
    "osmId": 948332291,
    "confidence": "high",
    "status": "verified"
  },
  "p_bailuzhou": {
    "lat": 32.0194287,
    "lon": 118.7897433,
    "osmType": "way",
    "osmId": 88807020,
    "confidence": "high",
    "status": "verified-coordinate-only"
  },
  "p_cafe_zw": {
    "lat": 32.0477103,
    "lon": 118.7747492,
    "osmType": "node",
    "osmId": 5641064621,
    "confidence": "high",
    "status": "verified"
  },
  "p_book_dz": {
    "lat": 32.04455,
    "lon": 118.77617,
    "osmType": "node",
    "osmId": 2706957988,
    "confidence": "high",
    "status": "verified"
  },
  "p_food_wl": {
    "lat": 32.013581,
    "lon": 118.7822306,
    "osmType": "node",
    "osmId": 8794529019,
    "confidence": "high",
    "status": "verified"
  },
  "p_nanjing_eye": {
    "lat": 31.998311,
    "lon": 118.696873,
    "osmType": "way",
    "osmId": 321392362,
    "confidence": "medium",
    "status": "verified"
  },
  "p_zhongshanling": {
    "lat": 32.06018,
    "lon": 118.848543,
    "osmType": "relation",
    "osmId": 18303735,
    "confidence": "medium",
    "status": "verified"
  },
  "p_mingxiaoling": {
    "lat": 32.062314,
    "lon": 118.834704,
    "osmType": "way",
    "osmId": 380923041,
    "confidence": "medium",
    "status": "verified"
  },
  "p_nanjing_museum": {
    "lat": 32.042299,
    "lon": 118.819887,
    "osmType": "way",
    "osmId": 319998727,
    "confidence": "medium",
    "status": "verified"
  },
  "p_presidential_palace": {
    "lat": 32.04609,
    "lon": 118.792206,
    "osmType": "way",
    "osmId": 62353727,
    "confidence": "medium",
    "status": "verified"
  },
  "p_six_dynasties": {
    "lat": 32.044784,
    "lon": 118.794282,
    "osmType": "way",
    "osmId": 1061577687,
    "confidence": "medium",
    "status": "verified"
  },
  "p_jiangning_weaving": {
    "lat": 32.044648,
    "lon": 118.788981,
    "osmType": "way",
    "osmId": 205421877,
    "confidence": "medium",
    "status": "verified"
  },
  "p_folk_museum": {
    "lat": 32.027691,
    "lon": 118.776544,
    "osmType": "node",
    "osmId": 13745109131,
    "confidence": "high",
    "status": "verified"
  },
  "p_zhanyuan": {
    "lat": 32.0231,
    "lon": 118.780054,
    "osmType": "way",
    "osmId": 91997298,
    "confidence": "medium",
    "status": "verified"
  },
  "p_jiangnan_exam": {
    "lat": 32.023086,
    "lon": 118.785483,
    "osmType": "node",
    "osmId": 1608062767,
    "confidence": "high",
    "status": "verified"
  },
  "p_wuyi_lane": {
    "lat": 32.019864,
    "lon": 118.785976,
    "osmType": "way",
    "osmId": 91997683,
    "confidence": "medium",
    "status": "verified"
  },
  "p_city_wall_museum": {
    "lat": 32.014595,
    "lon": 118.777701,
    "osmType": "way",
    "osmId": 1183607105,
    "confidence": "medium",
    "status": "verified"
  },
  "p_zhonghuamen": {
    "lat": 32.0145171,
    "lon": 118.7763911,
    "osmType": "relation",
    "osmId": 11308636,
    "confidence": "medium",
    "status": "verified"
  },
  "p_yuhuatai": {
    "lat": 32.0006529,
    "lon": 118.7780548,
    "osmType": "way",
    "osmId": 62381499,
    "confidence": "medium",
    "status": "verified"
  },
  "p_dabaoensi": {
    "lat": 32.0112465,
    "lon": 118.7782558,
    "osmType": "relation",
    "osmId": 19786016,
    "confidence": "medium",
    "status": "verified"
  },
  "p_jiming_temple": {
    "lat": 32.062962,
    "lon": 118.789928,
    "osmType": "way",
    "osmId": 319055520,
    "confidence": "medium",
    "status": "verified"
  },
  "p_taicheng": {
    "lat": 32.0637819,
    "lon": 118.7902212,
    "osmType": "way",
    "osmId": 89637327,
    "confidence": "medium",
    "status": "verified"
  },
  "p_yuejianglou": {
    "lat": 32.096168,
    "lon": 118.741324,
    "osmType": "way",
    "osmId": 461035531,
    "confidence": "medium",
    "status": "verified"
  },
  "p_jinghaisi": {
    "lat": 32.094035,
    "lon": 118.739672,
    "osmType": "way",
    "osmId": 461035548,
    "confidence": "medium",
    "status": "verified"
  },
  "p_tianfeigong": {
    "lat": 32.09433,
    "lon": 118.741091,
    "osmType": "way",
    "osmId": 606914250,
    "confidence": "medium",
    "status": "verified"
  },
  "p_chaotiangong": {
    "lat": 32.036581,
    "lon": 118.770333,
    "osmType": "way",
    "osmId": 446638070,
    "confidence": "medium",
    "status": "verified"
  },
  "p_nju": {
    "lat": 32.056596,
    "lon": 118.774088,
    "osmType": "way",
    "osmId": 88779953,
    "confidence": "medium",
    "status": "verified"
  },
  "p_seu": {
    "lat": 32.057648,
    "lon": 118.788282,
    "osmType": "relation",
    "osmId": 16272607,
    "confidence": "medium",
    "status": "verified"
  },
  "p_njnu": {
    "lat": 32.055056,
    "lon": 118.762101,
    "osmType": "way",
    "osmId": 89638729,
    "confidence": "medium",
    "status": "verified"
  },
  "p_nanjing_library": {
    "lat": 32.044111,
    "lon": 118.790488,
    "osmType": "way",
    "osmId": 94327966,
    "confidence": "medium",
    "status": "verified"
  },
  "p_jiangsu_art_museum": {
    "lat": 32.043494,
    "lon": 118.7936,
    "osmType": "way",
    "osmId": 318198215,
    "confidence": "medium",
    "status": "verified"
  },
  "p_yunjin_museum": {
    "lat": 32.038434,
    "lon": 118.73957,
    "osmType": "node",
    "osmId": 1036715454,
    "confidence": "high",
    "status": "verified"
  },
  "p_paleontology_museum": {
    "lat": 32.06167,
    "lon": 118.79011,
    "osmType": "way",
    "osmId": 439252888,
    "confidence": "medium",
    "status": "verified"
  },
  "p_geology_museum": {
    "lat": 32.04671,
    "lon": 118.802057,
    "osmType": "way",
    "osmId": 1086342490,
    "confidence": "medium",
    "status": "verified"
  },
  "p_crossing_memorial": {
    "lat": 32.0757,
    "lon": 118.726512,
    "osmType": "node",
    "osmId": 3637368211,
    "confidence": "high",
    "status": "verified"
  },
  "p_meiyuan": {
    "lat": 32.045077,
    "lon": 118.7964813,
    "osmType": "way",
    "osmId": 1231581899,
    "confidence": "medium",
    "status": "verified"
  },
  "p_mochou_lake": {
    "lat": 32.03717,
    "lon": 118.756725,
    "osmType": "way",
    "osmId": 62688789,
    "confidence": "medium",
    "status": "verified"
  },
  "p_qingliangshan": {
    "lat": 32.05215,
    "lon": 118.755493,
    "osmType": "way",
    "osmId": 62114524,
    "confidence": "medium",
    "status": "verified"
  },
  "p_gulin_park": {
    "lat": 32.0687,
    "lon": 118.748217,
    "osmType": "way",
    "osmId": 89638712,
    "confidence": "medium",
    "status": "verified"
  },
  "p_guofang_park": {
    "lat": 32.052783,
    "lon": 118.749655,
    "osmType": "way",
    "osmId": 89638713,
    "confidence": "medium",
    "status": "verified"
  },
  "p_jiuhuashan": {
    "lat": 32.0616,
    "lon": 118.803314,
    "osmType": "way",
    "osmId": 91828656,
    "confidence": "medium",
    "status": "verified"
  },
  "p_qinglv_park": {
    "lat": 32.072127,
    "lon": 118.805193,
    "osmType": "node",
    "osmId": 9738902024,
    "confidence": "high",
    "status": "verified"
  },
  "p_baima_park": {
    "lat": 32.06321,
    "lon": 118.811667,
    "osmType": "way",
    "osmId": 92361437,
    "confidence": "medium",
    "status": "verified"
  },
  "p_botanical_garden": {
    "lat": 32.057734,
    "lon": 118.828279,
    "osmType": "relation",
    "osmId": 18303734,
    "confidence": "medium",
    "status": "verified"
  },
  "p_yueya_lake": {
    "lat": 32.031306,
    "lon": 118.822766,
    "osmType": "way",
    "osmId": 61857785,
    "confidence": "medium",
    "status": "verified"
  },
  "p_wulongtan": {
    "lat": 32.047835,
    "lon": 118.76059,
    "osmType": "way",
    "osmId": 782612164,
    "confidence": "medium",
    "status": "verified"
  },
  "p_xiaotaoyuan": {
    "lat": 32.082627,
    "lon": 118.741601,
    "osmType": "way",
    "osmId": 292442876,
    "confidence": "medium",
    "status": "verified"
  },
  "p_pipa_lake": {
    "lat": 32.055545,
    "lon": 118.817194,
    "osmType": "way",
    "osmId": 62700582,
    "confidence": "medium",
    "status": "verified"
  },
  "p_qianhu": {
    "lat": 32.050321,
    "lon": 118.825424,
    "osmType": "way",
    "osmId": 62700589,
    "confidence": "medium",
    "status": "verified"
  },
  "p_meihua_mountain": {
    "lat": 32.055763,
    "lon": 118.835155,
    "osmType": "way",
    "osmId": 791617219,
    "confidence": "medium",
    "status": "verified"
  },
  "p_stone_city": {
    "lat": 32.052524,
    "lon": 118.747671,
    "osmType": "node",
    "osmId": 5524053921,
    "confidence": "high",
    "status": "verified"
  },
  "p_hunan_road": {
    "lat": 32.071289,
    "lon": 118.775647,
    "osmType": "way",
    "osmId": 422957216,
    "confidence": "medium",
    "status": "verified"
  },
  "p_shiziqiao": {
    "lat": 32.069691,
    "lon": 118.772625,
    "osmType": "way",
    "osmId": 89566369,
    "confidence": "medium",
    "status": "verified"
  },
  "p_sanqiba_lane": {
    "lat": 32.01743,
    "lon": 118.785867,
    "osmType": "way",
    "osmId": 91997678,
    "confidence": "medium",
    "status": "verified"
  },
  "p_kexiang": {
    "lat": 32.041183,
    "lon": 118.791213,
    "osmType": "way",
    "osmId": 89637244,
    "confidence": "medium",
    "status": "verified"
  },
  "p_pingshi_street": {
    "lat": 32.032604,
    "lon": 118.775236,
    "osmType": "way",
    "osmId": 779232501,
    "confidence": "medium",
    "status": "verified"
  },
  "p_xinanli": {
    "lat": 32.026888,
    "lon": 118.776148,
    "osmType": "relation",
    "osmId": 14290821,
    "confidence": "medium",
    "status": "verified"
  },
  "p_deji_plaza": {
    "lat": 32.045086,
    "lon": 118.779713,
    "osmType": "way",
    "osmId": 147223223,
    "confidence": "medium",
    "status": "verified"
  },
  "p_golden_eagle": {
    "lat": 32.052995,
    "lon": 118.779434,
    "osmType": "way",
    "osmId": 192105389,
    "confidence": "medium",
    "status": "verified"
  },
  "p_hongmiao": {
    "lat": 32.049661,
    "lon": 118.785094,
    "osmType": "way",
    "osmId": 89637281,
    "confidence": "medium",
    "status": "verified"
  },
  "p_xiaoxihu": {
    "lat": 32.017907,
    "lon": 118.781937,
    "osmType": "way",
    "osmId": 91997674,
    "confidence": "medium",
    "status": "verified"
  }
};

  /* 室内外属性：产品标注，不是营业事实；null = 未知 */
  const INDOOR = {
  "p_yihe": false,
  "p_book_xf": true,
  "p_xinjiekou": false,
  "p_changjiang": false,
  "p_xuanwu": false,
  "p_qinhuai": false,
  "p_laomendong": false,
  "p_bailuzhou": false,
  "p_cafe_zw": true,
  "p_book_dz": true,
  "p_food_wl": true,
  "p_nanjing_eye": false,
  "p_zhongshanling": false,
  "p_mingxiaoling": false,
  "p_nanjing_museum": true,
  "p_presidential_palace": false,
  "p_six_dynasties": true,
  "p_jiangning_weaving": true,
  "p_folk_museum": true,
  "p_zhanyuan": false,
  "p_jiangnan_exam": false,
  "p_wuyi_lane": false,
  "p_city_wall_museum": true,
  "p_zhonghuamen": false,
  "p_yuhuatai": false,
  "p_dabaoensi": true,
  "p_jiming_temple": true,
  "p_taicheng": false,
  "p_yuejianglou": false,
  "p_jinghaisi": true,
  "p_tianfeigong": true,
  "p_chaotiangong": true,
  "p_nju": false,
  "p_seu": false,
  "p_njnu": false,
  "p_nanjing_library": true,
  "p_jiangsu_art_museum": true,
  "p_yunjin_museum": true,
  "p_paleontology_museum": true,
  "p_geology_museum": true,
  "p_crossing_memorial": true,
  "p_meiyuan": true,
  "p_mochou_lake": false,
  "p_qingliangshan": false,
  "p_gulin_park": false,
  "p_guofang_park": false,
  "p_jiuhuashan": false,
  "p_qinglv_park": false,
  "p_baima_park": false,
  "p_botanical_garden": false,
  "p_yueya_lake": false,
  "p_wulongtan": false,
  "p_xiaotaoyuan": false,
  "p_pipa_lake": false,
  "p_qianhu": false,
  "p_meihua_mountain": false,
  "p_stone_city": false,
  "p_hunan_road": false,
  "p_shiziqiao": false,
  "p_sanqiba_lane": false,
  "p_kexiang": false,
  "p_pingshi_street": false,
  "p_xinanli": false,
  "p_deji_plaza": true,
  "p_golden_eagle": true,
  "p_hongmiao": false,
  "p_xiaoxihu": false
};

  PLACES.forEach(p => {
    const g = GEO[p.id] || {};
    p.lat = typeof g.lat === 'number' ? g.lat : null;
    p.lng = typeof g.lon === 'number' ? g.lon : null;
    p.geoStatus = g.status || 'unverified';
    p.geoConfidence = g.confidence || null;
    p.geoSource = g.osmType ? ('OpenStreetMap ' + g.osmType + '/' + g.osmId) : null;
    p.geoLicense = g.osmType ? 'ODbL 1.0 © OpenStreetMap contributors' : null;
    p.geoVerified = typeof g.lat === 'number';
    p.indoor = Object.prototype.hasOwnProperty.call(INDOOR, p.id) ? INDOOR[p.id] : null;
  });

  const DATA_VERSION = '2026-10-29';
  const GEO_ATTRIBUTION = '坐标来源：OpenStreetMap contributors（ODbL 1.0）；照片部分来自高德 POI，非商业自用；部分坐标为区域中心点，非入口坐标。';

  const api = {
    IMG, CATEGORIES, CITIES, THEMES, INTERESTS, PACES, TRANSPORTS,
    PLACES, CURATED_ROUTES, FEATURED_PLACE_IDS, GEO, DATA_VERSION, GEO_ATTRIBUTION,

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
      sample: '地点数据 · 非真实导航结果',
      estimate: '时长、距离与费用均为估算值',
      hours: '营业信息待确认',
      map: '示意地图 · 坐标来自 OpenStreetMap（WGS84）',
      realMap: '真实地图 · 坐标来自 OpenStreetMap，路线为示意连线，非导航路径',
      genericPlace: '未核验地点 · 无单一实体 · 不参与真实地图定位'
    }
  };

  return api;
});
