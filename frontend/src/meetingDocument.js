import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, Footer, AlignmentType, PageNumber,
} from "docx";

const converter = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
converter.use(gfm);
export function documentMarkdown(content = "") {
  return /^\s*<(?:p|div|h[1-6]|ul|ol|table|blockquote)\b/i.test(content)
    ? converter.turndown(content) : content;
}

function runs(tokens = [], style = {}) {
  return tokens.flatMap((token) => {
    if (token.type === "strong") return runs(token.tokens, { ...style, bold: true });
    if (token.type === "em") return runs(token.tokens, { ...style, italics: true });
    if (token.type === "br") return [new TextRun({ text: "", break: 1, ...style })];
    if (token.type === "link") return runs(token.tokens, style);
    const text = token.type === "image" ? token.text : token.text ?? token.raw ?? "";
    return text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "").split("\n").flatMap((line, index) => [
      ...(index ? [new TextRun({ text: "", break: 1 })] : []), new TextRun({ text: line, ...style }),
    ]);
  });
}

// 0,2 inci (288 twip) per tingkat butir agar sub-butir menjorok rapi.
const LIST_INDENT_STEP = 288;
const LIST_HANGING = 200;

function blocks(tokens, level = 0) {
  const result = [];
  for (const token of tokens) {
    if (token.type === "space" || token.type === "def") continue;
    if (token.type === "heading") {
      const text = token.text.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, "");
      result.push(new Paragraph({ children: runs(marked.lexer(text)[0]?.tokens || [{ text }]),
        heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(token.depth, 3) - 1],
        keepNext: true, spacing: { before: 240, after: 120 } }));
    } else if (token.type === "table") {
      const makeRow = (cells, header = false) => new TableRow({ tableHeader: header, cantSplit: true,
        children: cells.map((cell) => new TableCell({
          width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
          ...(header ? { shading: { type: ShadingType.CLEAR, fill: "E8EDF5" } } : {}),
          children: [new Paragraph({ children: runs(cell.tokens, { bold: header, size: 20 }), spacing: { after: 60 } })],
        })) });
      result.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [makeRow(token.header, true), ...token.rows.map((row) => makeRow(row))] }));
      result.push(new Paragraph({ text: "", spacing: { after: 100 } }));
    } else if (token.type === "list") {
      token.items.forEach((item, index) => {
        let first = true;
        for (const child of item.tokens) {
          if (child.type === "list") { result.push(...blocks([child], level + 1)); continue; }
          if (child.type === "space") continue;
          const prefix = first ? (token.ordered ? `${Number(token.start || 1) + index}. ` : "• ") : "";
          result.push(new Paragraph({ children: [new TextRun(prefix), ...runs(child.tokens || [{ text: child.text || "" }])],
            indent: { left: LIST_INDENT_STEP * (level + 1), hanging: first ? LIST_HANGING : 0 }, spacing: { after: 80 } }));
          first = false;
        }
      });
    } else {
      result.push(new Paragraph({ children: runs(token.tokens || [{ text: token.text || "" }]), spacing: { after: 140, line: 276 } }));
    }
  }
  return result;
}

export async function createMeetingDocx(content = "", filename = "Notulen Rapat") {
  const markdown = documentMarkdown(content);
  const body = blocks(marked.lexer(markdown));
  if (!body.length) body.push(new Paragraph(""));
  const doc = new Document({
    creator: "Resmeet STT", title: filename.replace(/\.[^.]+$/, ""),
    styles: {
      default: { document: { run: { font: "Arial", size: 22 }, paragraph: { spacing: { line: 276, after: 140 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: "Arial", size: 32, bold: true, color: "223B5A" }, paragraph: { keepNext: true, spacing: { before: 260, after: 140 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: "Arial", size: 27, bold: true, color: "223B5A" }, paragraph: { keepNext: true, spacing: { before: 220, after: 120 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: "Arial", size: 24, bold: true }, paragraph: { keepNext: true, spacing: { before: 180, after: 100 } } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Halaman ", size: 18, color: "64748B" }), new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
      children: body,
    }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
