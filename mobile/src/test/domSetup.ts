type MiniNode = {
  nodeType: number;
  nodeName: string;
  tagName: string;
  childNodes: MiniNode[];
  parentNode: MiniNode | null;
  ownerDocument: MiniNode | null;
  namespaceURI: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  textContent: string;
  nodeValue: string | null;
  value: string;
  type: string;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  appendChild(child: MiniNode): MiniNode;
  insertBefore(child: MiniNode, before: MiniNode | null): MiniNode;
  removeChild(child: MiniNode): MiniNode;
  addEventListener(): void;
  removeEventListener(): void;
  focus(): void;
  blur(): void;
  contains(other: MiniNode): boolean;
  setSelectionRange(): void;
};

function makeNode(type: string, nodeType: number): MiniNode {
  const node: MiniNode = {
    nodeType,
    nodeName: type,
    tagName: type,
    childNodes: [],
    parentNode: null,
    ownerDocument: null,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    style: {},
    attributes: {},
    textContent: "",
    nodeValue: null,
    value: "",
    type: "text",
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      const index = before ? this.childNodes.indexOf(before) : -1;
      if (index < 0) this.childNodes.push(child);
      else this.childNodes.splice(index, 0, child);
      return child;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) this.childNodes.splice(index, 1);
      if (child.parentNode === this) child.parentNode = null;
      return child;
    },
    addEventListener() { /* no-op */ },
    removeEventListener() { /* no-op */ },
    focus() { /* no-op */ },
    blur() { /* no-op */ },
    contains(other) {
      if (other === this) return true;
      return this.childNodes.some((child) => child.contains(other));
    },
    setSelectionRange() { /* no-op */ },
  };
  Object.defineProperty(node, "firstChild", { get() { return node.childNodes[0] || null; } });
  Object.defineProperty(node, "lastChild", { get() { return node.childNodes[node.childNodes.length - 1] || null; } });
  Object.defineProperty(node, "nextSibling", {
    get() {
      const kids = node.parentNode?.childNodes || [];
      const index = kids.indexOf(node);
      return index >= 0 ? kids[index + 1] || null : null;
    },
  });
  return node;
}

function ctor(name: string) {
  const fn = function miniCtor() { /* host class stub */ };
  Object.defineProperty(fn, "name", { value: name });
  return fn;
}

export function installMiniDom() {
  const g = globalThis as any;
  if (g.__miniDom) return;
  const document = makeNode("#document", 9) as MiniNode & {
    createElement: (tag: string) => MiniNode;
    createElementNS: (ns: string, tag: string) => MiniNode;
    createTextNode: (text: string) => MiniNode;
    activeElement: MiniNode | null;
    documentElement: MiniNode;
    body: MiniNode;
    head: MiniNode;
    defaultView: unknown;
  };
  document.createElement = (tag: string) => {
    const el = makeNode(String(tag).toUpperCase(), 1);
    el.ownerDocument = document;
    return el;
  };
  document.createElementNS = (_ns: string, tag: string) => document.createElement(tag);
  document.createTextNode = (text: string) => {
    const textNode = makeNode("#text", 3);
    textNode.nodeValue = String(text);
    textNode.textContent = String(text);
    textNode.ownerDocument = document;
    return textNode;
  };
  document.activeElement = null;
  document.documentElement = document.createElement("html");
  document.body = document.createElement("body");
  document.head = document.createElement("head");
  document.appendChild(document.documentElement);
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  const window = {
    document,
    HTMLElement: ctor("HTMLElement"),
    HTMLIFrameElement: ctor("HTMLIFrameElement"),
    Element: ctor("Element"),
    Node: ctor("Node"),
    getSelection: () => null,
    addEventListener() { /* no-op */ },
    removeEventListener() { /* no-op */ },
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  };
  document.defaultView = window;
  g.window = window;
  g.document = document;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.__miniDom = true;
}

installMiniDom();

export function textOf(node: any): string {
  if (!node) return "";
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.childNodes?.length) return node.childNodes.map((child: any) => textOf(child)).join("");
  return node.textContent || "";
}

export function findByTestId(node: any, id: string): any {
  if (!node) return null;
  if (node.getAttribute?.("data-testid") === id) return node;
  for (const child of node.childNodes || []) {
    const hit = findByTestId(child, id);
    if (hit) return hit;
  }
  return null;
}

export function reactProps(node: any): Record<string, any> | null {
  if (!node) return null;
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
  return key ? node[key] : null;
}

export function clickable(node: any): any {
  let cur = node;
  while (cur) {
    const props = reactProps(cur);
    if (props && (typeof props.onClick === "function" || typeof props.onPress === "function")) return cur;
    cur = cur.parentNode;
  }
  return null;
}
