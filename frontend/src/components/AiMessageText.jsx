import React from "react";

/**
 * AI yanıtlarındaki hafif markdown'ı React düğümlerine çevirir.
 * Metin asla HTML olarak işlenmez; etiketler düz metin olarak kalır.
 */

function isWordChar(ch) {
  if (!ch) return false;
  if (/[0-9A-Za-z_]/.test(ch)) return true;
  return ch.toLowerCase() !== ch.toUpperCase();
}

function parseInline(text, prefix) {
  const nodes = [];
  let plain = "";
  let i = 0;
  let n = 0;
  const flush = () => {
    if (!plain) return;
    nodes.push(plain);
    plain = "";
  };
  const push = (el) => {
    flush();
    nodes.push(el);
  };

  while (i < text.length) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        push(<code key={`${prefix}-c${n}`} className="rounded bg-slate-100 px-1 py-px font-mono text-[0.92em]">{text.slice(i + 1, end)}</code>);
        n += 1;
        i = end + 1;
        continue;
      }
    }

    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        push(<strong key={`${prefix}-b${n}`}>{text.slice(i + 2, end)}</strong>);
        n += 1;
        i = end + 2;
        continue;
      }
    }

    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1 && text[end + 1] !== "*") {
        const inner = text.slice(i + 1, end);
        if (inner && !inner.includes("*") && !/^\s/.test(inner) && !/\s$/.test(inner)) {
          push(<em key={`${prefix}-e${n}`}>{inner}</em>);
          n += 1;
          i = end + 1;
          continue;
        }
      }
    }

    if (text[i] === "_" && text[i + 1] !== "_" && !isWordChar(text[i - 1])) {
      const end = text.indexOf("_", i + 1);
      if (end > i + 1 && text[end + 1] !== "_" && !isWordChar(text[end + 1])) {
        const inner = text.slice(i + 1, end);
        if (inner && !inner.includes("_") && !/^\s/.test(inner) && !/\s$/.test(inner)) {
          push(<em key={`${prefix}-u${n}`}>{inner}</em>);
          n += 1;
          i = end + 1;
          continue;
        }
      }
    }

    plain += text[i];
    i += 1;
  }
  flush();
  return nodes;
}

function parseBlocks(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push({ type: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(list);
    list = null;
  };

  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      flushList();
      return;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "h", text: heading[2] });
      return;
    }
    const ordered = /^(\d+)\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushPara();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[2]);
      return;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(bullet[1]);
      return;
    }
    flushList();
    para.push(line);
  });
  flushPara();
  flushList();
  return blocks;
}

function renderBlock(block, index) {
  if (block.type === "h") {
    return (
      <p key={`h-${index}`} className="font-semibold">
        <strong>{parseInline(block.text, `h${index}`)}</strong>
      </p>
    );
  }
  if (block.type === "ul" || block.type === "ol") {
    const Tag = block.type === "ol" ? "ol" : "ul";
    return (
      <Tag key={`${block.type}-${index}`} className={block.type === "ol" ? "list-decimal pl-5 space-y-0.5" : "list-disc pl-5 space-y-0.5"}>
        {block.items.map((item, j) => (
          <li key={j}>{parseInline(item, `${block.type}${index}-${j}`)}</li>
        ))}
      </Tag>
    );
  }
  const children = [];
  block.lines.forEach((line, j) => {
    if (j > 0) children.push(<br key={`br-${index}-${j}`} />);
    children.push(...parseInline(line, `p${index}-${j}`));
  });
  return <p key={`p-${index}`}>{children}</p>;
}

export default function AiMessageText({ text }) {
  const blocks = parseBlocks(text);
  if (!blocks.length) return null;
  return <div className="ai-message-text space-y-2">{blocks.map(renderBlock)}</div>;
}
