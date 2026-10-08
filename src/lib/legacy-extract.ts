// Extracts the PRE and CLI arrays from the legacy mdc-mock-200.html WITHOUT executing it:
// a tiny tokenizer parses array/string literals only.

export type LegacyEntry = {
  topic: string;
  stem: string;
  correct: string;
  wrong: [string, string, string];
  explanation: string;
};

type Node = string | Node[];

class Parser {
  private i: number;
  constructor(private s: string, start: number) {
    this.i = start;
  }

  private skipSpace() {
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) return;
      if (/\s/.test(c)) this.i++;
      else if (c === "/" && this.s[this.i + 1] === "/") {
        while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
      } else if (c === "/" && this.s[this.i + 1] === "*") {
        const end = this.s.indexOf("*/", this.i + 2);
        if (end < 0) throw new Error("Unterminated comment");
        this.i = end + 2;
      } else return;
    }
  }

  private string(quote: string): string {
    let out = "";
    this.i++; // opening quote
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined) throw new Error("Unterminated string");
      if (c === quote) return out;
      if (quote === "`" && c === "$" && this.s[this.i] === "{") throw new Error("Template interpolation is not supported");
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "v": out += "\v"; break;
        case "0": out += "\0"; break;
        case "x": out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 2), 16)); this.i += 2; break;
        case "u":
          if (this.s[this.i] === "{") {
            const end = this.s.indexOf("}", this.i);
            out += String.fromCodePoint(parseInt(this.s.slice(this.i + 1, end), 16));
            this.i = end + 1;
          } else {
            out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16));
            this.i += 4;
          }
          break;
        case "\r": if (this.s[this.i] === "\n") this.i++; break; // line continuation
        case "\n": break;
        default: out += e;
      }
    }
  }

  value(): Node {
    this.skipSpace();
    const c = this.s[this.i];
    if (c === "[") return this.array();
    if (c === "'" || c === '"' || c === "`") return this.string(c);
    throw new Error(`Unexpected character ${JSON.stringify(c)} at offset ${this.i}`);
  }

  private array(): Node[] {
    const items: Node[] = [];
    this.i++; // [
    for (;;) {
      this.skipSpace();
      if (this.s[this.i] === "]") {
        this.i++;
        return items;
      }
      items.push(this.value());
      this.skipSpace();
      if (this.s[this.i] === ",") this.i++;
      else if (this.s[this.i] !== "]") throw new Error(`Expected , or ] at offset ${this.i}`);
    }
  }
}

function extractArray(html: string, name: string): Node[] {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*`).exec(html);
  if (!m) throw new Error(`Array ${name} not found in file`);
  const node = new Parser(html, m.index + m[0].length).value();
  if (!Array.isArray(node)) throw new Error(`${name} is not an array`);
  return node;
}

function toEntries(name: string, rows: Node[]): LegacyEntry[] {
  return rows.map((row, idx) => {
    if (!Array.isArray(row) || row.length !== 7 || !row.every((x) => typeof x === "string")) {
      throw new Error(`${name}[${idx}] must be 7 strings: [topic, stem, correct, wrong1, wrong2, wrong3, explanation]`);
    }
    const [topic, stem, correct, w1, w2, w3, explanation] = row as string[];
    return { topic: topic.trim(), stem: stem.trim(), correct: correct.trim(), wrong: [w1.trim(), w2.trim(), w3.trim()], explanation: explanation.trim() };
  });
}

export function extractLegacy(html: string): { PRE: LegacyEntry[]; CLI: LegacyEntry[] } {
  return { PRE: toEntries("PRE", extractArray(html, "PRE")), CLI: toEntries("CLI", extractArray(html, "CLI")) };
}
