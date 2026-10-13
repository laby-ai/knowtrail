# 课题组共享弹窗布局调整

- 弹窗最大宽度由 4xl 调整为 6xl，明确使用网格间距和不透明背景。
- 桌面采用 240px 文档列表与自适应正文两栏，窄屏改为单列。
- 列表标题与版本纵向排列，选中文档提供状态标记。
- 协作说明折叠，正文、批注、成员权限、共享文献和版本记录分区增加留白。
- 成员邮箱与权限宽屏并排、窄屏堆叠，长邮箱和操作按钮允许换行。
- 共享授权、正文同步、版本恢复和文献接口逻辑沿用现有实现。

## 验证与发布

- 三个修改组件 ESLint 通过，TypeScript 检查通过。
- Next webpack 生产构建和服务端 tsup 打包通过。已有 ingestion-store 动态依赖警告仍存在。
- 使用现有 scripts/test-collaboration-api.ts，通过 tsx 执行：并发合并、幂等重试、只读角色、在线状态、批注、恢复、异常输入及即时撤权均通过。首次 CJS 打包运行因 import.meta.url 不兼容失败，改为项目现有 tsx 后通过。
- 浏览器视觉验收未完成：Tabbit CLI 返回 CLI_REGISTRATION_UNAVAILABLE，需浏览器恢复注册后重试；未把代码检查当作截图验收。
- 已发布 /opt/knowtrail/releases/lingbi-sharing-layout-20261013；服务 active，线上 /lingbi/ 返回 HTTP 200。
- 回滚入口 /opt/knowtrail/previous-sharing-layout-20261013 保留。
