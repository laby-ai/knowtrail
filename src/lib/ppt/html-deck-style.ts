// HTML deck style contracts adapted from the huashu-design PPT style library
// (github.com/alchaincyf/huashu-design, MIT). Each contract is a strict visual
// specification fed to the text LLM that writes self-contained slide HTML.

export interface HtmlDeckStyleDef {
  id: string;
  label: string;
  labelEn: string;
  color: string;      // UI chip color
  tone: 'bold' | 'neutral' | 'quiet';
  contract: string;   // full visual contract for the generation prompt
}

const FONT_STACK_SANS = `-apple-system, 'SF Pro Display', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif`;
const FONT_STACK_SERIF = `Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif SC', 'SimSun', serif`;
const FONT_STACK_MONO = `'SF Mono', 'Cascadia Code', Consolas, 'JetBrains Mono', 'Courier New', monospace`;

export const HTML_DECK_STYLES: HtmlDeckStyleDef[] = [
  {
    id: 'neo-swiss',
    label: '新瑞士大字报',
    labelEn: 'Neo-Swiss Billboard',
    color: '#2D5BFF',
    tone: 'bold',
    contract: `新瑞士大字报 / Neo-Swiss Billboard Editorial(参照顶级 AI/SaaS 路演 deck 的 Big-Number Editorial 流派):
- 配色:纯白 #FFFFFF 底(章节页可整页电光蓝 #2D5BFF 色块),文字近黑 #0A0A0A,唯一强调色电光蓝 #2D5BFF,网格线 #E5E5E5。
- 字体:超大粗体无衬线(font-family: ${FONT_STACK_SANS}),标题可占半屏,数字用 font-variant-numeric: tabular-nums 并收紧字距。
- 母版:①章节页=满版蓝色块+一个反白大词 ②数据页=巨型数字(约 200-280px)占半屏+小字注释 ③内容页=严格 CSS Grid 左右分栏 ④图表页=纯 SVG 扁平折线/柱状。
- 禁止:插画、3D、渐变、阴影、圆角、emoji。零装饰,秩序即美。`,
  },
  {
    id: 'black-stage',
    label: '黑底数字剧场',
    labelEn: 'Black Big-Number Stage',
    color: '#111111',
    tone: 'bold',
    contract: `黑底巨型数字剧场 / Black Big-Number Stage(参照 Jobs 2007 Keynote、Presentation Zen):
- 配色:纯黑 #000000 底+纯白 #FFFFFF 字,每页最多一个强调色高亮(苹果蓝 #2997FF),其余信息用 #8E8E93 灰。
- 字体:几何无衬线粗体(font-family: ${FONT_STACK_SANS}),一屏一词或一个超大数字(240px+)flex 居中,letter-spacing 收紧(-0.03em)。
- 母版:①标题页=黑底居中一行大字 ②数据高潮页=巨型数字+单位+一行小注 ③对比页=左右双栏(强调色 vs 灰) ④金句页=单句宣言。
- 每页文字总量不超过 30 字。大量负空间,克制到极致。禁止:图片、渐变、装饰边框、emoji。`,
  },
  {
    id: 'bento',
    label: 'Bento 便当格',
    labelEn: 'Bento Grid',
    color: '#F59E0B',
    tone: 'neutral',
    contract: `Bento 便当格模块网格 / Bento Grid(参照 Apple Keynote Bento 时代、Stripe 指标卡矩阵):
- 配色:浅灰奶白底 #F5F5F7,卡片纯白 #FFFFFF,文字 #1D1D1F,强调色琥珀 #F59E0B 或深蓝 #0071E3(全稿只选一个),辅助灰 #86868B。
- 字体:无衬线(font-family: ${FONT_STACK_SANS}),display 大标题+常规正文强字重对比,KPI 数字 tabular-nums。
- 母版:①标题页=巨型单句+大留白 ②bento 页=CSS Grid grid-template-areas 做 2×2 或 3 列不等高卡片,每卡一个洞见(大数字/inline SVG 线性图标/迷你 sparkline) ③单洞见页=超大数字。
- 卡片:border-radius 24px、1px 微描边 rgba(0,0,0,0.06)、极淡阴影 0 2px 12px rgba(0,0,0,0.04)。呼吸感优先,单卡文字不超过 3 行。禁止:emoji 图标、紫渐变。`,
  },
  {
    id: 'terminal-dark',
    label: '暗色终端美学',
    labelEn: 'Dark Hairline Terminal',
    color: '#5B5BD6',
    tone: 'neutral',
    contract: `Neo-Swiss 暗色终端美学 / Dark Hairline Terminal(参照 Linear pitch deck、Vercel 设计语言):
- 配色:近黑底 #111113(不是纯黑,不是 GitHub 深蓝 #0D1117),hairline 细线 #262629,正文 #EDEDEF,次级 #A0A0A6,唯一强调紫蓝 #7C7CFF。
- 字体:无衬线大标题(font-family: ${FONT_STACK_SANS})+等宽小标签(font-family: ${FONT_STACK_MONO},11-13px,uppercase,letter-spacing 0.08em)。
- 母版:①标题页=一句话+mono 小标签 ②数据网格页=1px hairline border 分隔的表格化网格 ③特性列表=mono 编号(01/02/03)+标题+一行说明。
- 质感全靠 1px 细线和留白,微高亮用 border 颜色提亮,禁止 glow/霓虹/渐变。`,
  },
  {
    id: 'consulting',
    label: '双字体咨询版',
    labelEn: 'Two-Font Consulting',
    color: '#051C2C',
    tone: 'neutral',
    contract: `双字体咨询版 / Two-Font Consulting(参照 McKinsey 2019 品牌系统、BCG Executive Perspectives):
- 配色:白底或暖灰底 #FAF9F7,主色深蓝 #051C2C,单一高亮 BCG 绿 #00805A,分割线 #D9D6D0。
- 字体:衬线大标题(font-family: ${FONT_STACK_SERIF})与无衬线正文(font-family: ${FONT_STACK_SANS})高对比并置。
- 母版:①每页左上角一句"结论式 action-title"(完整判断句,不是名词短语,衬线 28-34px) ②标题下主体=杂志式左右分工(左结论文字右数据视觉,或三列要点) ③大数字 data-point 卡 ④深蓝细线 pattern(repeating-linear-gradient)做局部装饰。
- 图表:纯 SVG,单色阶梯高亮(强调项用绿,其余灰化 #C8C4BD)。页脚可留细线+页码。权威、克制、每页必须给出判断。`,
  },
  {
    id: 'swiss-minimal',
    label: '瑞士机构极简',
    labelEn: 'Institutional Swiss',
    color: '#FF5A3C',
    tone: 'quiet',
    contract: `瑞士机构极简 / Institutional Swiss Minimal(参照 Sequoia 10 页模板、Müller-Brockmann 网格):
- 配色:纯白 #FFFFFF 底,黑 #111 与灰 #555 正文,单一强调色珊瑚红 #FF5A3C(用量<5%)。
- 字体:Helvetica 系无衬线(font-family: ${FONT_STACK_SANS}),标题中号粗体一句话(40-56px),正文短句大行距(1.6)。
- 母版:①封面=居中标题+一行 slogan ②三栏对仗页=顶部一句话标题带+下方 Flexbox 三栏(每栏小标题+两行说明) ③大数字分层页(TAM 式嵌套) ④2×2 矩阵页(CSS Grid+1px border)。
- 一页一信息,绝不拥挤。禁止:阴影、圆角卡片、图标堆砌、任何装饰。`,
  },
  {
    id: 'editorial',
    label: '杂志编辑长文',
    labelEn: 'Editorial Longform',
    color: '#635BFF',
    tone: 'quiet',
    contract: `杂志编辑长文流 / Editorial Longform(参照 Stripe Annual Letter、Amazon 叙事备忘录):
- 配色:奶白底 #FBFAF8,深墨字 #1A1A1A,品牌紫点睛 #635BFF(仅标题编号、内联数据、分隔线)。
- 字体:衬线正文(font-family: ${FONT_STACK_SERIF},18-21px,line-height 1.75,行宽 ≤65ch)+无衬线辅助信息;超大 display 数字穿插(衬线,120px+)。
- 母版:①刊头页=期刊式大标题+副题+细线 ②正文页=两栏散文排版,段落间嵌入内联指标卡(细边框小卡片:大数字+一行说明) ③锚点页=超大数字/金句独占。
- 出版物阅读节奏:散文体完整句,不用 bullet 列表;克制留白;细节排印(首字母/编号用紫色)。禁止:图标、粗阴影、大色块。`,
  },
  {
    id: 'assertion-evidence',
    label: '断言-证据学术',
    labelEn: 'Assertion-Evidence',
    color: '#1E3A5F',
    tone: 'quiet',
    contract: `断言-证据 / Assertion-Evidence + Tufte 信息设计(参照 Michael Alley 学术汇报范式、Edward Tufte 数据墨水比):
- 配色:纯白底,黑 #111 正文,单一克制强调深蓝 #1E3A5F 或砖红 #9A3B26(全稿选一)。
- 字体:标题衬线或高品质无衬线(font-family: ${FONT_STACK_SANS}),正文 16-20px。
- 母版:每页顶部一行"整句断言标题"(完整的有观点的句子,28-34px,占两行以内),标题之下整页只放一件证据:一张纯 SVG 图表(折线/散点/柱状,去网格线去图例,标注文字直接贴在数据旁)或一个极简示意图或一组对照数据。
- 零 bullet、零 chartjunk、高数据墨水比;来源标注用 12px 灰字放右下角。学术、严谨、每页一个论点一件证据。`,
  },
];

export function getHtmlDeckStyle(id?: string): HtmlDeckStyleDef {
  return HTML_DECK_STYLES.find(s => s.id === id) || HTML_DECK_STYLES[7];
}

// Hard slide contract shared by every style: the geometry and self-containment
// rules that make preview scaling and PPTX reconstruction reliable.
export const HTML_SLIDE_HARD_CONTRACT = `
每一页幻灯片必须是一个完整、自包含的 HTML 文档,并严格满足:
1. <body> 尺寸恰好 1280×720 像素:body { width:1280px; height:720px; margin:0; overflow:hidden; box-sizing:border-box; position:relative; },所有后代元素 box-sizing:border-box。
2. 所有样式写在文档内唯一的 <style> 标签里;禁止外链 CSS/JS/字体/图片,禁止 <script>,禁止 @import,禁止网络请求。字体只用系统字体栈。
3. 内容绝不允许溢出 1280×720 画布(不出现滚动条);底部预留至少 48px 安全边距。
4. 图表、示意图一律用内联 SVG 或纯 CSS 绘制;数据必须来自给定资料,禁止编造数字。
5. 不使用 emoji 作图标;需要图标时用简洁的内联 SVG 线条图标。
6. 文本层级清晰:每页一个主标题;正文文字最小 14px;中文排版使用合理的 line-height(1.4-1.8)。
7. 输出的 HTML 用于演示投影,追求"顶级设计团队交付"的完成度:对齐到网格、间距一致、克制的层级。
8. 禁止出现"AI 味"最大公约数:紫色渐变万能背景、圆角卡片+左彩条、emoji 图标、Inter 全大写标语堆砌。`;
