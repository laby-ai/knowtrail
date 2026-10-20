"use client";
import { useAppPreferences } from './AppPreferencesProvider';
const EN: Record<string, string> = {
  '输入你的问题': 'Ask a research question', '输入问题加入等待队列…': 'Add a question to the queue…', 'Enter 发送，Shift+Enter 换行': 'Enter to send, Shift+Enter for a new line', '内容由 AI 生成，可能不准确，请注意核实。': 'AI-generated content may be inaccurate. Please verify important information.',
  '设置': 'Settings', '返回文献本': 'Back to notebooks', '产物中心': 'Research tools', '资料工具与生成结果': 'Research tools and generated results',
  '点击入口打开弹窗，检索或生成需在弹窗内确认。': 'Open a tool to search or generate. Confirm the task in its dialog.',
  '新建文献本': 'New notebook', '打开文献本': 'Open notebook', '最近打开': 'Recent notebooks', '个文献本': 'notebooks', '个来源': 'sources',
  '搜索文献本': 'Search notebooks', '登录账号': 'Sign in', '去登录': 'Sign in', '取消': 'Cancel', '创建': 'Create',
  '为研究主题命名，资料与对话将单独保存。': 'Name your research topic. Its sources and conversations are stored separately.', '文献本名称': 'Notebook name',
  '登录后可以继续保存和打开你的文献本。': 'Sign in to save and reopen your notebooks.',
  '文献库': 'Library', '文献检索': 'Literature search', '发现信源': 'Discover sources', '取消选择': 'Deselect', '删除所选': 'Delete selected',
  '文献矩阵': 'Literature matrix', '上传进度': 'Upload progress', '暂无文献来源': 'No sources yet', '添加资料': 'Add sources', '证据定位': 'Evidence location',
  '原文片段': 'Source excerpt', '上传到': 'Upload to', '文献库（首次上传自动创建）': 'Library (created on first upload)', '+ 新建目录…': '+ New folder…',
  '拖拽文献或资料文件到此处上传': 'Drop research files here to upload', '或点击选择论文、笔记、表格等文件': 'Or select papers, notes and spreadsheets',
  '新建文献分组': 'New source folder', '来源片段': 'Source excerpts', '打开原文链接': 'Open original source', '数据分析': 'Data analysis',
  '读取原文片段': 'Read source excerpts', '查看来源片段': 'View source excerpts', '删除来源': 'Delete source',
  '学术对话': 'Research chat', '生成综述报告': 'Generate review', '开始学术问答': 'Start a research conversation', '输入你的问题…': 'Ask a research question…',
  '核心论点': 'Key arguments', '方法对比': 'Compare methods', '研究发现': 'Findings', '研究局限': 'Limitations', '实验设计': 'Experimental design',
  '未来方向': 'Future directions', '异同对比': 'Compare findings', '关键数据': 'Key data', '研究记录': 'Research history', '课题组共享': 'Team sharing',
  '跨库文献检索': 'Literature search', '深度研究': 'Deep research', '研究脉络': 'Research map', '假设生成': 'Hypothesis generation',
  '实验数据分析': 'Research data analysis', '学术写作': 'Academic writing', '文本润色': 'Text polishing', '科研绘图': 'Scientific illustration', 'PPT 制作': 'Presentations',
  '论文审查': 'Paper review', '虚拟课堂': 'Virtual classroom', '文献调研': 'Literature review', '论文写作与汇报': 'Writing and presentations', '审查与科研交流': 'Review and collaboration',
  '检索、核验并加入文献库': 'Search, verify and add to your library', '基于已选来源生成可追溯报告': 'Create a traceable report from selected sources', '核心词、关系与证据': 'Concepts, relationships and evidence',
  '依据、反例与可证伪预测': 'Evidence, counterexamples and testable predictions', '真实表格诊断与基线方案': 'Analyze tables and establish a baseline', '对照、随机化与预注册协议': 'Controls, randomization and preregistration',
  '段落证据与主张映射': 'Map evidence to claims', '保护事实与可解释修订': 'Preserve facts and explain revisions', '来源约束的科研示意图': 'Scientific diagrams grounded in sources',
  '图片页 / 可编辑 PPT': 'Image slides / editable presentations', '定位问题与可执行建议': 'Identify issues and actionable revisions', '需连接课堂服务': 'Requires a classroom service',
  '读懂': 'Understand', '每篇文献': 'every paper', '开启科研模式': 'Start researching', '从一个文献本开始': 'Start with a notebook', '进入文献本': 'Open notebooks',
  '以你信任的来源为基础，把论文 PDF、网页、音频和研究笔记放进一个文献本，用提问、引用和组合材料继续研究。': 'Bring papers, web pages, audio and research notes into one notebook. Ask questions, trace citations and build on sources you trust.',
  '上传文献、提出研究问题、沿着证据追溯结果。': 'Upload sources, ask research questions and follow the evidence.',
  '可信赖的证据链': 'A traceable evidence chain', '科研工作路线图': 'Research workflow', '围绕真实来源，做研究与交流': 'Research and collaborate around real sources',
  '科研工作流': 'Research workflow', '证据溯源回答': 'Evidence-based answers', '生成一份文献简报': 'Create a research brief', '问题、回答与生成内容保存在一起': 'Keep questions, answers and research outputs together',
};
export function UiText({ children }: { children: string }) {
  const { preferences } = useAppPreferences();
  return preferences.interfaceLanguage === 'en' ? EN[children.trim()] || children : children;
}
export function useUiText() {
  const { preferences } = useAppPreferences();
  return (text: string) => preferences.interfaceLanguage === 'en' ? EN[text] || text : text;
}
