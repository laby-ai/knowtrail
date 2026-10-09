import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { exportDocx, exportLatex } from "../src/lib/manuscript-export";
import { groupJournalWorks } from "../src/lib/journal-discovery";
import type { AcademicWritingDraft } from "../src/lib/academic-writing-contract";

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "lingbi-manuscript-test-"));
  process.env.RESEARCH_DOCUMENT_STORE_PATH = root;
  const { mutateResearchDocument, listResearchDocuments, CollaborationError } =
    await import("../src/lib/research-collaboration-store");
  const owner = {
    id: "owner",
    email: "owner@example.invalid",
    tenantId: "tenant-a",
  };
  const viewer = {
    id: "viewer",
    email: "viewer@example.invalid",
    tenantId: "tenant-a",
  };
  const editor = {
    id: "editor",
    email: "editor@example.invalid",
    tenantId: "tenant-a",
  };
  try {
    let document = await mutateResearchDocument(owner, {
      action: "create",
      notebookId: "test-book",
      title: "权限验收",
      content: "原始内容",
    });
    assert.equal((await listResearchDocuments(viewer)).length, 0);
    document = await mutateResearchDocument(owner, {
      action: "members",
      id: document.id,
      revision: 1,
      members: [
        { email: viewer.email, role: "viewer" },
        { email: editor.email, role: "editor" },
      ],
    });
    assert.equal((await listResearchDocuments(viewer)).length, 1);
    assert.equal(
      (await listResearchDocuments({ ...viewer, tenantId: "tenant-b" })).length,
      0,
    );
    await assert.rejects(
      mutateResearchDocument(viewer, {
        action: "save",
        id: document.id,
        revision: 2,
        title: "非法改动",
        content: "禁止",
      }),
      (error) => error instanceof CollaborationError && error.status === 403,
    );
    await assert.rejects(
      mutateResearchDocument(editor, {
        action: "members",
        id: document.id,
        revision: 2,
        members: [],
      }),
      (error) => error instanceof CollaborationError && error.status === 403,
    );
    const updates = await Promise.allSettled([
      mutateResearchDocument(editor, {
        action: "save",
        id: document.id,
        revision: 2,
        title: "编辑者修订",
        content: "保留事实[1]",
      }),
      mutateResearchDocument(owner, {
        action: "save",
        id: document.id,
        revision: 2,
        title: "冲突改动",
        content: "禁止覆盖",
      }),
    ]);
    assert.equal(
      updates.filter((item) => item.status === "fulfilled").length,
      1,
    );
    const conflict = updates.find((item) => item.status === "rejected");
    assert(
      conflict?.status === "rejected" &&
        conflict.reason instanceof CollaborationError &&
        conflict.reason.status === 409,
    );
    const latest = (await listResearchDocuments(owner))[0];
    assert.equal(latest.content, "保留事实[1]");
    assert.equal(latest.history[0].content, "原始内容");
    await mutateResearchDocument(owner, {
      action: "members",
      id: latest.id,
      revision: latest.revision,
      members: [],
    });
    assert.equal((await listResearchDocuments(editor)).length, 0);
    const draft: AcademicWritingDraft = {
      title: "中文学术稿导出验收",
      targetSection: "introduction",
      outline: [],
      paragraphs: [
        {
          role: "evidence",
          text: "中文、希腊字母 α 与特殊符号 A&B <0.05、50%_value 应完整保留[1]。",
          evidenceMarkers: [1],
          supportStatus: "supported",
        },
        {
          role: "limitation",
          text: "此文本为隔离验收材料，不是研究结论。",
          evidenceMarkers: [],
          supportStatus: "needs-evidence",
        },
      ],
      claimEvidenceMap: [],
      limitations: ["来源片段需作者核验。"],
      revisionChecklist: ["检查原文与目标期刊要求。"],
    };
    const citations = [
      {
        paperId: "test-source",
        paperShortName: "验收来源",
        sourceTitle: "中文来源与定位",
        excerpt: "这是真实文件格式测试的隔离材料。",
        page: 3,
        chunkIndex: 2,
      },
    ];
    for (const layout of ["single", "double"] as const) {
      const bytes = await exportDocx(draft, citations, layout);
      const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file("word/document.xml")!.async("text");
      assert(xml.includes("A&amp;B &lt;0.05"));
      assert(xml.includes('w:vertAlign w:val="superscript"'));
      assert(xml.includes("第 3 页"));
      assert(xml.includes(`w:num="${layout === "double" ? 2 : 1}"`));
      const tex = exportLatex(draft, citations, layout);
      assert(tex.includes("50\\%\\_value"));
      assert(tex.includes("中文来源与定位"));
      assert(!tex.includes("\\write18"));
      if (process.argv[2])
        await writeFile(
          path.join(process.argv[2], `manuscript-${layout}.docx`),
          bytes,
        );
    }
    const journals = groupJournalWorks({
      message: {
        items: [
          {
            type: "journal-article",
            "container-title": ["Verified Journal"],
            DOI: "10.1234/test",
            title: ["Verified paper"],
            ISSN: ["1234-5678"],
          },
          {
            type: "posted-content",
            "container-title": ["Not a journal"],
            DOI: "10.1234/preprint",
          },
        ],
      },
    });
    assert.equal(journals.length, 1);
    assert.equal(journals[0].matchedWorks[0].doi, "10.1234/test");
    console.log(
      "PASS: exports, escaping, provenance, owner/viewer/editor, tenant isolation, conflict and revocation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
