import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export interface JournalWordTemplate {
  name: string;
  stylesXml: string;
  themeXml?: string;
  numberingXml?: string;
  sectionXml: string;
  columns: number;
  styles: Array<{ id: string; name: string }>;
  titleStyle: string;
  bodyStyle: string;
  headingStyle: string;
}
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseAttributeValue: false,
  processEntities: true,
});
interface ZipChunkStream {
  on(event: "data", callback: (chunk: Uint8Array) => void): ZipChunkStream;
  on(event: "error", callback: (error: Error) => void): ZipChunkStream;
  on(event: "end", callback: () => void): ZipChunkStream;
  pause(): ZipChunkStream;
  resume(): ZipChunkStream;
}
interface StreamingZipEntry {
  internalStream(type: "uint8array"): ZipChunkStream;
}
function supportsStreaming(
  entry: JSZip.JSZipObject,
): entry is JSZip.JSZipObject & StreamingZipEntry {
  return (
    "internalStream" in entry && typeof entry.internalStream === "function"
  );
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}
function attribute(value: unknown, name: string) {
  const item = object(value)[`@_${name}`];
  return typeof item === "string" ? item : "";
}
function validXml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true)
    throw new Error("模板 XML 无效，请重新下载 DOCX 模板。");
  return object(parser.parse(text));
}
function xmlPart(
  text: string,
  name: string,
  namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
) {
  const normalized = validXml(text);
  const source = object(
    new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      processEntities: true,
    }).parse(text),
  );
  const key = Object.keys(source).find((key) => key.split(":").pop() === name);
  if (!key) throw new Error("模板 XML 结构无效。");
  const prefix = key.includes(":") ? key.split(":")[0] : "";
  if (
    attribute(source[key], prefix ? `xmlns:${prefix}` : "xmlns") !== namespace
  )
    throw new Error("模板 XML 命名空间无效。");
  return object(normalized[name]);
}
async function readBounded(
  zip: JSZip,
  name: string,
  optional = false,
): Promise<string | undefined> {
  const entry = zip.file(name);
  if (!entry) {
    if (optional) return;
    throw new Error(`模板缺少 ${name}`);
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Uint8Array[] = [];
    if (!supportsStreaming(entry)) {
      reject(new Error("ZIP 读取组件不支持安全流式解码。"));
      return;
    }
    const stream = entry.internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        total += chunk.byteLength;
        if (total > 4 * 1024 * 1024) {
          stream.pause();
          reject(new Error("模板 XML 超过 4 MB，请精简模板。"));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => {
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(new TextDecoder().decode(bytes));
      })
      .resume();
  });
}
function size(value: string, fallback: number, maximum = 40000) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum)
    throw new Error("模板纸张或页边距参数无效。");
  return parsed;
}
export async function inspectJournalWordTemplate(
  bytes: Uint8Array,
  name: string,
): Promise<JournalWordTemplate> {
  if (bytes.length > 5 * 1024 * 1024)
    throw new Error("请选择不超过 5 MB 的 DOCX 模板。");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("文件不是有效的 DOCX 模板，请重新下载或选择。");
  }
  if (Object.keys(zip.files).length > 1000)
    throw new Error("模板内容过多，请使用纯排版模板。");
  const stylesXml = (await readBounded(zip, "word/styles.xml"))!,
    documentXml = (await readBounded(zip, "word/document.xml"))!;
  const stylesRoot = xmlPart(stylesXml, "styles");
  const entries = array(stylesRoot.style)
    .map(object)
    .filter((item) => attribute(item, "type") === "paragraph");
  const styles = entries
    .map((item) => ({
      id: attribute(item, "styleId"),
      name: attribute(item.name, "val") || attribute(item, "styleId"),
    }))
    .filter((item) => item.id);
  if (!styles.length || styles.length > 500)
    throw new Error("模板没有可用的段落样式，或样式过多。");
  if (styles.some((style) => style.id.length > 255 || style.name.length > 255))
    throw new Error("模板样式名称或编号过长，请精简模板。");
  const body = object(xmlPart(documentXml, "document").body),
    section = object(body.sectPr);
  if (!Object.keys(section).length) throw new Error("模板缺少纸张和分栏设置。");
  const width = size(attribute(section.pgSz, "w"), 11906),
    height = size(attribute(section.pgSz, "h"), 16838);
  const margins = Object.fromEntries(
    ["top", "right", "bottom", "left"].map((key) => [
      key,
      size(attribute(section.pgMar, key), 1417),
    ]),
  );
  if (
    width < 5000 ||
    height < 5000 ||
    margins.left + margins.right >= width ||
    margins.top + margins.bottom >= height
  )
    throw new Error("模板的可用页面面积无效。");
  const columns = size(attribute(section.cols, "num"), 1, 2);
  if (columns < 1) throw new Error("模板分栏设置无效。");
  const spacing = size(attribute(section.cols, "space"), 420, 2000);
  const sectionXml = `<w:sectPr><w:pgSz w:w="${width}" w:h="${height}"/><w:pgMar w:top="${margins.top}" w:right="${margins.right}" w:bottom="${margins.bottom}" w:left="${margins.left}"/><w:cols w:num="${columns}" w:space="${spacing}"/></w:sectPr>`;
  const pick = (ids: string[]) =>
    ids.find((id) => styles.some((item) => item.id === id)) || styles[0].id;
  const themeXml = await readBounded(zip, "word/theme/theme1.xml", true),
    numberingXml = await readBounded(zip, "word/numbering.xml", true);
  if (themeXml)
    xmlPart(
      themeXml,
      "theme",
      "http://schemas.openxmlformats.org/drawingml/2006/main",
    );
  if (numberingXml) xmlPart(numberingXml, "numbering");
  return {
    name,
    stylesXml,
    themeXml,
    numberingXml,
    sectionXml,
    columns,
    styles,
    titleStyle: pick(["PaperTitle", "Title", "标题"]),
    bodyStyle: pick(["PARA", "BodyText", "Normal", "正文"]),
    headingStyle: pick(["H1ListNoSpace", "Heading1", "H1", "标题1"]),
  };
}
