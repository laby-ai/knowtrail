# 科研界面动效发布记录

已于 2026-10-12 发布，功能提交 `de7ce73`。
发布目录：`/opt/knowtrail/releases/lingbi-research-motion-20261012`。
回滚链接：`/opt/knowtrail/previous-research-motion-20261012`。

参考 React Bits 固定提交 `2139cb3098d4fedc6264f13e50dcb4694224ba7c` 的 AnimatedContent、FadeContent、SpotlightCard。采用适合现有科研界面的改写，来源与许可证保存在 `THIRD_PARTY_NOTICES/react-bits/`，未新增 GSAP、WebGL 或其他依赖。

- 首页内容最多 12px、440ms 一次入场，不隐藏服务端已渲染文字；滚动观察器和事件监听随组件销毁清理。
- 文献本、产物入口采用悬停/键盘聚焦的局部聚光，桌面悬停 2px，触屏和减少动态效果时静态显示。沿用一次鼠标移动至多一帧的委托更新，不启动持续渲染循环。
- 弹窗入场 180ms、退出 110ms，背景保持既有实色，不让正文持续跳动或模糊。
- 系统减少动态效果变化即时取消新增动效；背景介绍视频不在减少动态效果、后台或离开视口时自动播放，保留手动控制。
- 修正旧主题悬停规则和 Tailwind 独立 translate 叠加、入场动画长期持有 transform 的冲突。

验证：TypeScript、新改组件 ESLint、生产构建通过；浏览器原生 reduced-motion 媒体模拟下文字可见、视频暂停、卡片无追光/位移、弹窗静态。恢复动效后指针坐标更新、聚光透明度、2px 悬停和键盘焦点可见；弹窗实色、180ms 动画及 390px 布局通过。桌面首页截图已检查；移动截图工具超时，移动尺寸/交互验证已完成，不宣称真实手机或 Safari 真机验收。线上服务 active，首页 HTTP 200。构建保留既有 ingestion-store 动态依赖警告。
