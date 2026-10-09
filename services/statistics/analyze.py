"""Curated statistics runner. Reads JSON on stdin; no user code is executed.

Reproduce locally: python analyze.py input.csv analysis-config.json > result.json
"""
import base64
import io
import hashlib
import json
import math
import sys
import warnings
import zipfile

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats


def number(value):
    value = float(value)
    return value if math.isfinite(value) else None


def read_dataset(config):
    data = base64.b64decode(config["fileBase64"], validate=True)
    if len(data) > 25 * 1024 * 1024:
        raise ValueError("统计分析单文件上限为 25 MB。")
    if config["fileType"] == "xlsx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if len(archive.infolist()) > 5000 or sum(item.file_size for item in archive.infolist()) > 150 * 1024 * 1024:
                raise ValueError("表格解压体积过大，请拆分后分析。")
        frame = pd.read_excel(io.BytesIO(data), sheet_name=config.get("sheetName") or 0, nrows=50001, engine="openpyxl")
    else:
        try:
            frame = pd.read_csv(io.BytesIO(data), encoding="utf-8-sig", nrows=50001)
        except UnicodeDecodeError:
            frame = pd.read_csv(io.BytesIO(data), encoding="gb18030", nrows=50001)
    if len(frame) > 50000 or len(frame.columns) > 200:
        raise ValueError("当前支持最多 50000 行、200 列，请拆分数据。")
    frame.columns = [str(column).strip() for column in frame.columns]
    if len(set(frame.columns)) != len(frame.columns):
        raise ValueError("字段名称重复，请使用唯一列名。")
    if frame.empty:
        raise ValueError("表格没有数据行。")
    return frame


def summarize(label, values, confidence):
    values = np.asarray(values, dtype=float)
    n = len(values)
    mean = float(np.mean(values))
    sd = float(np.std(values, ddof=1)) if n > 1 else None
    half = float(stats.t.ppf(0.975, n - 1) * sd / math.sqrt(n)) if confidence and n > 1 and sd > 0 else None
    return {"group": str(label), "n": n, "mean": mean, "sd": sd,
            "ciLow": number(mean - half) if half is not None else None,
            "ciHigh": number(mean + half) if half is not None else None,
            "min": float(np.min(values)), "max": float(np.max(values))}


def analyze(config):
    frame = read_dataset(config)
    target = config.get("targetColumn")
    group = config.get("groupColumn")
    method = config.get("method", "auto")
    available = list(frame.columns)
    if not target:
        numeric = [column for column in available if pd.to_numeric(frame[column], errors="coerce").notna().sum() > 0]
        if not numeric:
            raise ValueError("未找到可分析的数值列，请指定目标列。")
        target = numeric[0]
    if target not in frame.columns or (group and group not in frame.columns):
        raise ValueError("所选字段在原文件中不存在，请核对列名。")
    values = pd.to_numeric(frame[target], errors="coerce").replace([np.inf, -np.inf], np.nan)
    valid = values.notna()
    notes = []
    if group:
        valid &= frame[group].notna()
    if method == "linear-regression":
        if not group:
            raise ValueError("线性回归需要指定一个数值自变量。")
        x_all = pd.to_numeric(frame[group], errors="coerce").replace([np.inf, -np.inf], np.nan)
        valid &= x_all.notna()
    else:
        x_all = None
    y = values[valid].to_numpy(dtype=float)
    if not len(y):
        raise ValueError("目标列没有有效数值。")
    removed = int(len(frame) - len(y))
    if removed:
        notes.append(f"删除 {removed} 行缺失、非数值或非有限值；未填补缺失值。")
    if group and method != "linear-regression":
        labels = frame.loc[valid, group].astype(str)
        groups = [(label, values.loc[labels.index][labels == label].to_numpy(dtype=float)) for label in labels.unique()]
        if len(groups) > 20:
            raise ValueError("分组超过 20 类，请重新选择分组列。")
    else:
        groups = [("全部样本", y)]
    if method == "auto":
        method = "welch-t" if group and len(groups) == 2 else "welch-anova" if group and len(groups) > 2 else "descriptive"
    if method != "descriptive" and not config.get("independentObservations"):
        raise ValueError("请先确认观测独立；配对或重复测量不能使用当前独立样本方法。")
    summaries = [summarize(label, data, config.get("independentObservations", False)) for label, data in groups]
    if not config.get("independentObservations"):
        notes.append("未确认独立观测，仅报告描述统计，不计算均值置信区间。")
    test = None
    if method == "welch-t":
        if len(groups) != 2 or any(len(data) < 2 for _, data in groups):
            raise ValueError("Welch t 检验需要两组，每组至少两个有效观测。")
        if all(np.var(data) == 0 for _, data in groups):
            raise ValueError("两组均为常量，无法估计可靠的 t 检验不确定性，请检查原始数据。")
        result = stats.ttest_ind(groups[0][1], groups[1][1], equal_var=False)
        interval = result.confidence_interval()
        test = {"name": "Welch 独立样本 t 检验", "statistic": number(result.statistic), "pValue": number(result.pvalue), "df": number(result.df),
                "effect": number(np.mean(groups[0][1]) - np.mean(groups[1][1])), "effectLabel": f"{groups[0][0]} 减 {groups[1][0]} 的均值差", "ciLow": number(interval.low), "ciHigh": number(interval.high)}
        notes.append("检验为双侧；请复核独立性、分布与异常值。均值差为第一组减第二组。")
    elif method == "welch-anova":
        if len(groups) < 3 or any(len(data) < 2 or np.var(data) == 0 for _, data in groups):
            raise ValueError("Welch ANOVA 需要至少三组，每组至少两个有效观测且方差非零。")
        result = stats.f_oneway(*(data for _, data in groups), equal_var=False)
        sizes = np.array([len(data) for _, data in groups])
        weights = sizes / np.array([np.var(data, ddof=1) for _, data in groups])
        denominator = np.sum((1 - weights / np.sum(weights)) ** 2 / (sizes - 1))
        test = {"name": "Welch 单因素 ANOVA", "statistic": number(result.statistic), "pValue": number(result.pvalue),
                "dfNumerator": len(groups) - 1, "dfDenominator": number((len(groups) ** 2 - 1) / (3 * denominator))}
        notes.append("整体检验不能指出哪些组不同；未执行事后多重比较。请复核独立性、分布与异常值。")
    elif method == "linear-regression":
        x = x_all[valid].to_numpy(dtype=float)
        if len(x) < 3 or len(np.unique(x)) < 2:
            raise ValueError("回归需要至少三个完整观测且自变量有变化。")
        result = stats.linregress(x, y)
        if result.stderr <= 0:
            raise ValueError("回归残差没有变化，无法估计可靠统计不确定性，请检查数据或增加观测。")
        half = stats.t.ppf(0.975, len(x) - 2) * result.stderr
        test = {"name": "简单线性回归", "statistic": number(result.slope / result.stderr) if result.stderr > 0 else None,
                "pValue": number(result.pvalue), "effect": number(result.slope), "effectLabel": "斜率", "ciLow": number(result.slope - half), "ciHigh": number(result.slope + half),
                "intercept": number(result.intercept), "rSquared": number(result.rvalue ** 2), "df": len(x) - 2}
        notes.append("R² 为样本内拟合指标，不代表外部预测性能。请复核线性关系、残差和独立性；不解释为因果关系。")
    elif method != "descriptive":
        raise ValueError("统计方法不支持。")
    if test and test["pValue"] is None:
        raise ValueError("数据不满足该检验的数值计算条件，请检查常量列、样本量和异常值。")
    matplotlib.rcParams.update({"font.family": "serif", "font.serif": ["DejaVu Serif"], "svg.fonttype": "none", "axes.spines.top": False, "axes.spines.right": False})
    fig, ax = plt.subplots(figsize=(7, 4), layout="constrained")
    if method == "linear-regression":
        stride = max(1, math.ceil(len(x) / 2000))
        ax.scatter(x[::stride], y[::stride], color="0.35", s=12, alpha=0.6)
        grid = np.linspace(np.min(x), np.max(x), 100)
        fitted = result.intercept + result.slope * grid
        residual_sd = math.sqrt(np.sum((y - result.intercept - result.slope * x) ** 2) / (len(x) - 2))
        confidence = stats.t.ppf(0.975, len(x) - 2) * residual_sd * np.sqrt(1 / len(x) + (grid - np.mean(x)) ** 2 / np.sum((x - np.mean(x)) ** 2))
        ax.plot(grid, fitted, color="black", linewidth=1)
        ax.fill_between(grid, fitted - confidence, fitted + confidence, color="0.85", label="95% CI of mean")
        ax.set_xlabel(group)
        if stride > 1: notes.append(f"散点图抽样显示，每 {stride} 个观测显示一个；统计计算使用全部有效观测。")
    else:
        for index, item in enumerate(summaries):
            if item["ciLow"] is not None:
                ax.errorbar(index, item["mean"], yerr=item["ciHigh"] - item["mean"], fmt="o", color="black", capsize=4, linewidth=1)
            else:
                ax.plot(index, item["mean"], "o", color="black")
        ax.set_xticks(range(len(summaries)), [item["group"] for item in summaries])
        has_confidence = any(item["ciLow"] is not None for item in summaries)
        ax.set_xlabel((group or "样本") + (" · 均值及 95% CI" if has_confidence else " · 均值（未计算置信区间）"))
    ax.set_ylabel(target)
    output = io.StringIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        fig.savefig(output, format="svg")
    plt.close(fig)
    paragraphs = [f"对 {len(frame)} 行数据中的 {len(y)} 个有效观测进行了分析，指标为“{target}”。"]
    for item in summaries:
        text = f"{item['group']}（n={item['n']}）均值为 {item['mean']:.4g}"
        if item["sd"] is not None: text += f"，标准差为 {item['sd']:.4g}"
        if item["ciLow"] is not None: text += f"，均值的 95% CI 为 [{item['ciLow']:.4g}, {item['ciHigh']:.4g}]"
        paragraphs.append(text + "。")
    if test:
        p_text = f"{test['pValue']:.4g}" if test["pValue"] > 0 else "<1e-300（数值下溢）"
        df_text = f"，df={test['df']:.4g}" if test.get("df") is not None else f"，df=({test['dfNumerator']:.4g}, {test['dfDenominator']:.4g})" if test.get("dfDenominator") is not None else ""
        paragraphs.append(f"{test['name']}：统计量={test['statistic'] if test['statistic'] is not None else '不适用'}{df_text}，p={p_text}。")
        if "effect" in test: paragraphs.append(f"{test['effectLabel']}={test['effect']:.4g}，95% CI [{test['ciLow']:.4g}, {test['ciHigh']:.4g}]。")
    return {"method": method, "sourceRows": len(frame), "usedRows": len(y), "removedRows": removed, "targetColumn": target, "groupColumn": group,
            "columns": available, "summaries": summaries, "test": test, "notes": notes,
            "chartSvg": output.getvalue(), "resultsDraft": "\n".join(paragraphs),
            "summaryCsv": pd.DataFrame(summaries).to_csv(index=False), "versions": {"numpy": np.__version__, "pandas": pd.__version__, "scipy": __import__('scipy').__version__,
            "matplotlib": matplotlib.__version__, "openpyxl": __import__('openpyxl').__version__, "scriptSha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest()}}


def main():
    if len(sys.argv) == 3:
        with open(sys.argv[2], encoding="utf-8") as handle: config = json.load(handle)
        with open(sys.argv[1], "rb") as handle: config["fileBase64"] = base64.b64encode(handle.read()).decode("ascii")
    else:
        raw = sys.stdin.buffer.read(36 * 1024 * 1024 + 1)
        if len(raw) > 36 * 1024 * 1024: raise ValueError("数据请求过大。")
        config = json.loads(raw)
    result = analyze(config)
    sys.stdout.write(json.dumps({"ok": True, "data": result}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
