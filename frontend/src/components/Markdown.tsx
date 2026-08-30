import type { ReactNode } from "react";

// Lightweight monochrome Markdown renderer (no deps): headings, paragraphs,
// ordered/unordered lists, quotes, fenced + inline code, bold/italic, tables.

interface Block {
  kind: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "quote" | "code" | "table";
  lines: string[];
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const fence = /^```/.exec(line.trim());
    if (fence) {
      const start = i + 1;
      let end = lines.length;
      for (let j = start; j < lines.length; j++) {
        if (/^```\s*$/.test(lines[j].trim())) { end = j; break; }
      }
      blocks.push({ kind: "code", lines: lines.slice(start, end) });
      i = end + 1;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: ("h" + h[1].length) as Block["kind"], lines: [h[2]] });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const start = i;
      while (i < lines.length && /^>\s?/.test(lines[i])) i++;
      blocks.push({ kind: "quote", lines: lines.slice(start, i).map((l) => l.replace(/^>\s?/, "")) });
      continue;
    }
    if (/^[-*]\s+/.test(line.trim())) {
      const start = i;
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) i++;
      blocks.push({ kind: "ul", lines: lines.slice(start, i).map((l) => l.trim().replace(/^[-*]\s+/, "")) });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line.trim())) {
      const start = i;
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) i++;
      blocks.push({ kind: "ol", lines: lines.slice(start, i).map((l) => l.trim().replace(/^\d+[.)]\s+/, "")) });
      continue;
    }
    // table: header row + separator row of |---|
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
      const start = i;
      i++;
      const rows: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(...[lines[i]]);
        i++;
      }
      blocks.push({ kind: "table", lines: [header.join("||"), ...rows] });
      continue;
    }
    // paragraph continuation
    const start = i;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3})\s|^>[>\s]|^[-*]\s|^\d+[.)]\s|^```/.test(lines[i])) i++;
    blocks.push({ kind: "p", lines: lines.slice(start, i) });
  }
  return blocks;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<strong key={`${keyBase}-b${k}`}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<code key={`${keyBase}-c${k}`}>{m[3]}</code>);
    else if (m[4] !== undefined) out.push(<em key={`${keyBase}-i${k}`}>{m[4]}</em>);
    last = re.lastIndex;
    k++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "h1": return <h1 key={key}>{inline(b.lines[0], key)}</h1>;
          case "h2": return <h2 key={key}>{inline(b.lines[0], key)}</h2>;
          case "h3": return <h3 key={key}>{inline(b.lines[0], key)}</h3>;
          case "quote": return <blockquote key={key}>{b.lines.map((l, j) => <p key={j}>{inline(l, `${key}-${j}`)}</p>)}</blockquote>;
          case "ul": return (
            <ul key={key}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${key}-${j}`)}</li>)}</ul>
          );
          case "ol": return (
            <ol key={key}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${key}-${j}`)}</li>)}</ol>
          );
          case "code": return <pre key={key}><code>{b.lines.join("\n")}</code></pre>;
          case "table": {
            const header = (b.lines[0] ?? "").split("||").map((c) => c.trim());
            const rows = b.lines.slice(1).map((r) => r.split("|").map((c) => c.trim()).filter((c) => c !== ""));
            return (
              <table key={key}>
                <thead><tr>{header.map((c, j) => <th key={j}>{inline(c, `${key}-th${j}`)}</th>)}</tr></thead>
                <tbody>{rows.map((r, j) => (
                  <tr key={j}>{r.map((c, x) => <td key={x}>{inline(c, `${key}-${j}-${x}`)}</td>)}</tr>
                ))}</tbody>
              </table>
            );
          }
          default: return <p key={key}>{b.lines.map((l, j) => <span key={j} className={j > 0 ? "md-wrappable" : ""}>{j > 0 ? "\n" : ""}{inline(l, `${key}-${j}`)}</span>)}</p>;
        }
      })}
    </div>
  );
}
