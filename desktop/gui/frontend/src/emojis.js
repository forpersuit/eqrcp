// desktop/gui/frontend/src/emojis.js

// 通用推荐表情
export const allEmojis = [
    '🚀','😎','💻','👍','🌟','🎨','🐶','🐱','🦊','🐻','🐼','🦁','🐵','🐣','🦄','🌈','⚡️','🎉','✨','🎮','🎵','🍔','🍉','🍕','🍺','🌍','🏠','🚗','💡','🔑','🔒','⚙️','🛡️','📡','📟','🤖','👽','👻','😈','🤡','💩','👀','🧠','👄','✍️','💎','🍎','🍓','🍩','☕️','🍻','✈️','🚲','🚂','🔔','📣'
];

// 国际化/文化特色表情
export const culturalEmojis = {
    zh: {
        name: {
            zh: '中国传统 (生肖与传统)',
            en: 'Chinese Heritage',
            ja: '中国の伝統',
            ko: '중국 전통',
            es: 'Tradición china',
            de: 'Chinesische Tradition',
            fr: 'Tradition chinoise'
        },
        emojis: [
            '🐼', // 熊猫
            '🏮', // 灯笼
            '🧧', // 红包
            '🥟', // 饺子
            '🎋', // 七夕/竹子
            '🍵', // 茶
            '🐉', // 龙
            '🦁', // 舞狮/狮子
            // 十二生肖
            '🐭', '🐮', '🐯', '🐰', '🐲', '🐍', '🐴', '🐑', '🐵', '🐔', '🐶', '🐷'
        ]
    },
    ja: {
        name: {
            zh: '日本风情 (樱花与美食)',
            en: 'Japanese Traditions',
            ja: '日本の伝統',
            ko: '일본 전통',
            es: 'Tradiciones japonesas',
            de: 'Japanische Traditionen',
            fr: 'Traditions japonaises'
        },
        emojis: [
            '🗻', // 富士山
            '🌸', // 樱花
            '🍣', // 寿司
            '🍜', // 拉面
            '🍱', // 便当
            '🎏', // 鲤鱼旗
            '⛩', // 神社
            '🍡', // 团子
            '🍵', // 绿茶
            '🥋', // 🥋
            '🎎', // 人偶
            '👹'  // 妖怪
        ]
    },
    ko: {
        name: {
            zh: '韩国潮流 (文化与美食)',
            en: 'Korean Wave',
            ja: '韓国の特色',
            ko: '한국 문화',
            es: 'Cultura coreana',
            de: 'Koreanische Kultur',
            fr: 'Culture coréenne'
        },
        emojis: [
            '🇰🇷', // 国旗
            '🍚', // 米饭
            '🥩', // 烤肉
            '🍲', // 汤锅
            '🍢', // 鱼饼
            '🥢', // 筷子
            '🏰', // 宫殿
            '🎤', // K-Pop
            '💃', // 舞蹈
            '🔥'  // 辣/热情
        ]
    },
    en: {
        name: {
            zh: '欧美流行 (经典与运动)',
            en: 'Western Classics',
            ja: '西洋のクラシック',
            ko: '서양 클래식',
            es: 'Clásicos occidentales',
            de: 'Westliche Klassiker',
            fr: 'Classiques occidentaux'
        },
        emojis: [
            '🗽', // 自由女神
            '🦅', // 鹰
            '🏈', // 美式橄榄球
            '⚾', // 棒球
            '🌭', // 热狗
            '🍔', // 汉堡
            '🍟', // 薯条
            '🛹', // 滑板
            '🎸', // 吉他
            '🎩', // 礼帽
            '☕'  // 咖啡
        ]
    },
    fr: {
        name: {
            zh: '浪漫法国 (艺术与美食)',
            en: 'French Romance',
            ja: 'フランスのロマン',
            ko: '프랑스 로맨스',
            es: 'Romance francés',
            de: 'Französische Romantik',
            fr: 'Romance française'
        },
        emojis: [
            '🗼', // 埃菲尔铁塔
            '🥐', // 牛角包
            '🍷', // 红酒
            '🧀', // 奶酪
            '🥖', // 法棍
            '🎨', // 调色板
            '🩰', // 芭蕾
            '💄', // 口红
            '🎭', // 歌剧
            '⛵'  // 帆船
        ]
    },
    es: {
        name: {
            zh: '西班牙与拉美 (热情与阳光)',
            en: 'Hispanic Passion',
            ja: 'ラテンの情熱',
            ko: '라틴 열정',
            es: 'Pasión hispana',
            de: 'Spanische Leidenschaft',
            fr: 'Passion hispanique'
        },
        emojis: [
            '💃', // 弗拉门戈舞者
            '🎸', // 吉他
            '🐂', // 斗牛
            '🍅', // 西红柿
            '⚽', // 足球
            '🌮', // 塔可
            '🌯', // 卷饼
            '🌶', // 辣椒
            '🥑', // 牛油果
            '☀️'  // 阳光
        ]
    },
    de: {
        name: {
            zh: '德国与中欧 (古堡与工业)',
            en: 'German Heritage',
            ja: 'ドイツの伝統',
            ko: '독일 유산',
            es: 'Herencia alemana',
            de: 'Deutsches Erbe',
            fr: 'Héritage allemand'
        },
        emojis: [
            '🥨', // 椒盐卷饼
            '🍺', // 啤酒
            '🍻', // 干杯
            '🌭', // 香肠
            '🏰', // 城堡
            '🌲', // 松树/黑森林
            '🚗', // 汽车
            '🎻', // 小提琴
            '🥔', // 土豆
            '⚽'  // 足球
        ]
    }
};

/**
 * 根据语言返回适合的文化推荐表情
 * @param {string} lang 语言标识，如 'zh', 'en', 'ja', 'ko', 'es', 'de', 'fr'
 * @returns {Array<string>} emoji 数组
 */
export function getCultureSpecificEmojis(lang) {
    const key = (lang || 'en').toLowerCase();
    const config = culturalEmojis[key] || culturalEmojis['en'];
    return config.emojis;
}

/**
 * 获取某个文化分组的本地化名称
 * @param {string} categoryKey 语言/国家标识
 * @param {string} currentLang 当前界面语言
 * @returns {string} 本地化名称
 */
export function getCategoryLocalizedName(categoryKey, currentLang) {
    const config = culturalEmojis[categoryKey];
    if (!config) return '';
    const lang = (currentLang || 'en').toLowerCase();
    return config.name[lang] || config.name['en'];
}
