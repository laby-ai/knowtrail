# 统计执行环境

新增 `POST /api/data-processing/execute` 从当前账号、当前文献本的已入库 CSV/XLSX 原文件读取数据，不使用前端 200 行预览进行统计。支持描述统计、Welch 双侧独立样本 t 检验、Welch 单因素 ANOVA、简单线性回归。用户必须指定样本单位；推断统计要求确认观测独立，不适用于配对或重复测量。

计算使用 SciPy，参考 [ttest_ind](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html)、[f_oneway](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.f_oneway.html)、[linregress](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.linregress.html)。t 检验报告均值差及 95% CI；ANOVA 报告整体检验、不声称已做事后比较；回归报告斜率及 CI、样本内 R²，不解释为因果或外部预测性能。未确认独立观测时不计算均值 CI；零方差、数据不足和无有效数值均返回可操作错误。

## 隔离与资源

- 运行已审核的固定 Python 脚本，API 不接受任意代码或任意文件路径。
- 容器 `--network none --read-only --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges`。
- 单任务 512 MiB、1 CPU、32 PID、75 秒；仅 `/tmp` 有 64 MiB 临时写空间。
- 最多两个并发任务，超时/取消后清理该任务唯一 UUID 的容器。
- 原文件最多 25 MiB、50,000 行、200 列；XLSX 解压上限 150 MiB。
- 仅接受当前账号上传记录中的 uploads 存储键；客户端不能提交 base64 数据替换服务器原文件。
- 原文件 SHA256、镜像标识、脚本 SHA256、计算方法和依赖版本随结果保存。源码校验不一致时阻止返回结果。
- 图表为程序绘制的 SVG，文字保留原始 Unicode；默认灰度、衬线体、规范坐标及可计算时的均值 95% CI。

## 部署

`services/statistics/Dockerfile` 默认使用固定摘要的 Python 3.12 基础镜像，requirements 固定直接和传递依赖。镜像来自 Public ECR 的 Python 镜像仓库；构建目录只包含代码、依赖及 Dockerfile，排除密钥、日志和数据。

```sh
docker build -t localhost/lingbi-statistics:VERSION services/statistics
docker image inspect localhost/lingbi-statistics:VERSION --format '{{.Id}}'
```

将得到的不可变镜像 ID 配置为服务器 `STATISTICS_RUNTIME_IMAGE`。不要将 `.env.production` 或用户数据提交到 Git。

结果按账号目录保存于 SOURCE_STORE_PATH 同级的 `data-analyses`（可使用 DATA_ANALYSIS_STORE_DIR 覆盖）。下载与读取结果必须重新校验账号。

## 交付与复现

生成统计结果、排除行数及说明、图表 SVG、摘要 CSV、Results 草稿、Python 脚本、参数 JSON 与依赖文件。

使用 Python 3.12 安装依赖后，运行：

```sh
python analyze.py ORIGINAL.csv analysis-config.json > result.json
```

Excel 替换文件名并保留配置中 sheetName。此环境不是任意 Python IDE；它执行固定方法，其他统计设计仍需专门接入。

## 本次验收

2026-10-09：真实隔离容器执行 CSV、501 行 CSV 和指定工作表 XLSX；校验 Welch t、Welch ANOVA、回归、缺失值、零方差、账号及文献本隔离和六类导出。浏览器使用隔离账号与真实计算结果回放验证结果表、Results 和 SVG 展示；生产构建通过。执行接口代理等待上限 150 秒。
