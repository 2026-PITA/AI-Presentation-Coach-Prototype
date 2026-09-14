const zlib = require("zlib");
const { PDFParse } = require("pdf-parse");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const filename = String(payload.filename || "").toLowerCase();
    const buffer = Buffer.from(payload.data || "", "base64");

    if (!buffer.length) {
      return json(400, { error: "파일 데이터가 없습니다." });
    }

    if (filename.endsWith(".docx")) {
      const text = extractDocxText(buffer);
      return json(200, { text, method: "DOCX 텍스트 추출 완료" });
    }

    if (filename.endsWith(".pdf")) {
      const text = await extractPdfText(buffer);
      return json(200, { text, method: "PDF 텍스트 추출 완료" });
    }

    if (filename.endsWith(".pptx")) {
      const text = extractPptxText(buffer);
      return json(200, { text, method: "PPTX 슬라이드 텍스트 추출 완료" });
    }

    return json(400, { error: "PDF, DOCX 또는 PPTX 파일만 지원합니다." });
  } catch (error) {
    return json(500, { error: error.message || "문서 텍스트 추출 실패" });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

function extractDocxText(buffer) {
  const xml = readZipEntry(buffer, "word/document.xml");
  if (!xml) throw new Error("DOCX 본문을 찾지 못했습니다.");

  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)
    ?.map((node) =>
      node
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    )
    .join(" ")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim() || "";
}

function readZipEntry(buffer, targetName) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("DOCX ZIP 구조를 읽지 못했습니다.");

  const entries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;

  for (let i = 0; i < entries; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .slice(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    if (name === targetName) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataStart, dataStart + compressedSize);
      const data =
        compression === 0
          ? compressed
          : compression === 8
            ? zlib.inflateRawSync(compressed)
            : null;
      if (!data) throw new Error("지원하지 않는 DOCX 압축 방식입니다.");
      return data.toString("utf8");
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return "";
}

function readZipEntries(buffer, predicate) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("ZIP 구조를 읽지 못했습니다.");

  const entries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const matches = [];
  let offset = centralDirectoryOffset;

  for (let i = 0; i < entries; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .slice(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    if (predicate(name)) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataStart, dataStart + compressedSize);
      const data =
        compression === 0
          ? compressed
          : compression === 8
            ? zlib.inflateRawSync(compressed)
            : null;
      if (data) matches.push({ name, text: data.toString("utf8") });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return matches;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function extractPptxText(buffer) {
  const slides = readZipEntries(
    buffer,
    (name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name),
  ).sort((a, b) => {
    const aNumber = Number(a.name.match(/slide(\d+)\.xml/i)?.[1] || 0);
    const bNumber = Number(b.name.match(/slide(\d+)\.xml/i)?.[1] || 0);
    return aNumber - bNumber;
  });

  if (!slides.length) throw new Error("PPTX 슬라이드 본문을 찾지 못했습니다.");

  const text = slides
    .map((slide, index) => {
      const items = [...slide.text.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlText(match[1]))
        .filter(Boolean);
      return items.length ? `[슬라이드 ${index + 1}]\n${items.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!text) throw new Error("PPTX에서 텍스트를 추출하지 못했습니다.");
  return text;
}

function decodeXmlText(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = (result.text || "")
      .replace(/--\s*\d+\s*of\s*\d+\s*--/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) {
      throw new Error("PDF에서 텍스트를 추출하지 못했습니다. 스캔 PDF일 수 있습니다.");
    }

    return text;
  } finally {
    await parser.destroy();
  }
}
