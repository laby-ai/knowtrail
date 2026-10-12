# 撤销前端动效

应用户要求，撤销 React Bits 动效提交 `086097e` 及配套修正 `f03ff54`、`e0fea79`、`de7ce73`，使用新的撤销提交 `7d2d9e0`，不改写 Git 历史。

受影响的首页组件、产物工具卡片、玻璃效果事件处理和全局 CSS 与动效添加前的 `b50e01d` 完全一致。删除新增 research-motion.css 及不再使用的 React Bits 第三方声明。恢复的是这批新增动效，既有界面交互沿用原版本。

设置和研究记录组件与撤销前 `092fad1` 完全一致，保留统一设置入口、账号/安全/百炼页签、记录分区及宽屏分栏。

验收：变更组件 ESLint、TypeScript、Next.js webpack 生产构建和服务器 tsup 构建通过；已有 ingestion-store 动态依赖构建警告保留。隔离浏览器验收确认新增动效 class 不存在、三个设置页签正常、实际 API 保存/读取记录、带入学术写作、390px 窄屏无横向溢出。账号展示使用隔离 fixture，没有提交密码重置或百炼配置。

已发布到 https://airai.world/lingbi/ ，服务 active、首页 HTTPS 200。发布目录 `/opt/knowtrail/releases/lingbi-motion-revert-20261012`；回滚入口 `/opt/knowtrail/previous-motion-revert-20261012`。撤销版本及文档推送至 `codex/lingbi-pdf-remaining-20261010`。
