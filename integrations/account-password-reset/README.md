> 当前默认入口已改为邮箱验证码：设置和登录页在当前页面完成密码重置，不要求打开邮件链接。旧链接接口只保留兼容此前邮件。

## 邮箱验证码

请求接口传 `mode: email_code`，返回公开的 challengeId 和有效期，不返回验证码。邮件发送 6 位随机验证码，10 分钟有效、60 秒后可重发；每次申请最多验证 5 次，连续错误后失效。校验摘要采用独立服务端密钥的 HMAC-SHA256，数据库不存明文验证码；`PASSWORD_RESET_CODE_SECRET` 仅存在服务器的 0600 环境文件，不进 Git。

重置成功后，密码更新、所有旧会话注销、全部旧验证码/链接失效在同一事务提交。界面保留成功提示，用户点击“重新登录”清除本机旧登录状态。关闭再打开弹窗可从 sessionStorage 恢复邮箱和公开申请编号，不保存验证码或密码。设置和未登录找回页复用同一组件，避免流程不一致。

已有链接版账号服务运行 `deploy-code.sh` 升级；首次安装先应用适配器并运行原账号部署，再运行验证码部署。代码部署会创建独立密钥环境文件、增加新表、备份模块/路由源码，并在健康检查失败时恢复原代码。

# 账号服务密码找回适配

此目录保存灵笔所需的账号服务源码增量、部署脚本和真实数据库测试；不包含账号数据库、用户资料、日志或邮件密钥。适配现有 `/opt/account-entitlement/account-system-new` 的 `auth.py`、`server.py`；应用脚本在旧实现不是 manual_follow_up 时拒绝覆盖。

接口：`POST /v1/auth/password-reset/request` 接收邮箱，`POST /v1/auth/password-reset/confirm` 接收 token 和 password。邮件通过现有 SMTP 配置发送；链接固定指向 `https://airai.world/lingbi/account/reset-password/`，凭证放在 URL fragment，页面读取后清除地址栏凭证。

配置：SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASSWORD、SMTP_FROM、PASSWORD_RESET_PUBLIC_URL。465 使用 TLS；其他端口强制 STARTTLS。凭据仅在服务器保存。部署脚本只添加公开的重置页面 URL，不复制 SMTP 凭据。

令牌为 32 字节随机值，只保存 SHA-256，15 分钟有效，仅可使用一次。新申请使旧链接失效；邮件发送失败使相应链接失效。确认重置、消费链接和注销旧会话同一事务提交。密码采用账号服务现有 PBKDF2 加密。每个邮箱 15 分钟最多申请 3 次，接口还有限速。注册与未注册邮箱的成功提示及连接失败提示保持一致。

`test_password_reset.py <隔离账号源码目录>` 测试邮件内容及捕获、旧密码/会话失效、过期/旧链接、并发消费、频率限制、弱密码不消费链接和邮件失败处理。支持 SQLite；PostgreSQL 测试须由调用者提供独立 schema 的 RESET_TEST_DATABASE_URL，禁止直接指定生产 schema。

部署前把 apply_patch.py 与 password_reset.py 放到服务器 /tmp，部署脚本备份两个原始源码文件、添加独立 systemd URL 配置、创建增量表并重启账号服务；健康检查失败自动恢复源码和配置。数据库变化为新增表，不修改已有用户或密码。重置生效后旧会话不可重新启用。
