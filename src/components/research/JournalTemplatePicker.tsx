"use client";
import { useState } from "react";
import { clientApiRequest } from "@/lib/client-api";
import { accountAuthHeaders } from "@/lib/account-session-browser";
import { IEEE_ACCESS_TEMPLATE } from "@/lib/journal-template-catalog";
import {
  inspectJournalWordTemplate,
  type JournalWordTemplate,
} from "@/lib/journal-word-template";
export function JournalTemplatePicker({
  value,
  onChange,
  onBusyChange,
}: {
  value: JournalWordTemplate | null;
  onChange: (template: JournalWordTemplate | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(get: () => Promise<{ bytes: Uint8Array; name: string }>) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const file = await get();
      onChange(await inspectJournalWordTemplate(file.bytes, file.name));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "模板读取失败，请重新选择 DOCX 文件。",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section
      className="space-y-2 rounded-lg border p-3 text-xs"
      data-testid="journal-template-picker"
    >
      <h4 className="font-semibold">Word 期刊模板</h4>
      <p className="leading-relaxed text-[var(--text-tertiary)]">
        套用模板的段落样式、纸张、页边距和栏数。替换示例正文；页眉、页脚、示例作者和资助信息需由作者另外填写。该设置用于
        Word 导出，LaTeX 保留通用排版。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="liquid-glass-btn px-3 py-2"
          onClick={() =>
            void load(async () => {
              const response = await clientApiRequest(
                `/api/research/templates?id=${IEEE_ACCESS_TEMPLATE.id}`,
                { headers: accountAuthHeaders(), timeoutMs: 30000 },
              );
              return {
                bytes: new Uint8Array(await response.arrayBuffer()),
                name: IEEE_ACCESS_TEMPLATE.name,
              };
            })
          }
        >
          {busy ? "正在读取模板…" : "使用 IEEE Access 官方 Word 样式"}
        </button>
        <label className="liquid-glass-btn cursor-pointer px-3 py-2">
          导入本地 Word 模板
          <input
            aria-label="导入 Word 期刊模板"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file)
                void load(async () => {
                  if (
                    !/\.docx$/i.test(file.name) ||
                    file.size > 5 * 1024 * 1024
                  )
                    throw new Error("请选择不超过 5 MB 的 DOCX 模板。");
                  return {
                    name: `本地模板：${file.name}`,
                    bytes: new Uint8Array(await file.arrayBuffer()),
                  };
                });
            }}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {value && (
        <>
          <p className="break-words">
            当前模板：{value.name} · {value.columns === 2 ? "双栏" : "单栏"}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["titleStyle", "bodyStyle", "headingStyle"] as const).map(
              (key, index) => (
                <label key={key}>
                  {["标题样式", "正文样式", "章节标题样式"][index]}
                  <select
                    className="liquid-glass-input mt-1 w-full"
                    value={value[key]}
                    onChange={(event) =>
                      onChange({ ...value, [key]: event.target.value })
                    }
                  >
                    {value.styles.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.name}
                      </option>
                    ))}
                  </select>
                </label>
              ),
            )}
          </div>
          <button
            type="button"
            className="liquid-glass-btn px-3 py-2"
            onClick={() => onChange(null)}
          >
            恢复通用 Word 排版
          </button>
        </>
      )}
      <a
        href={IEEE_ACCESS_TEMPLATE.guidanceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-[var(--accent-blue)]"
      >
        查看 IEEE Access 官方投稿说明
      </a>
      {value?.name === IEEE_ACCESS_TEMPLATE.name && (
        <p className="text-[var(--text-tertiary)]">
          IEEE Access
          要求英文稿。这里导出章节套版草稿，作者信息、完整书目和投稿条件仍需核对。
        </p>
      )}
    </section>
  );
}
