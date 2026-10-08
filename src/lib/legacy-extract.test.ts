import { describe, expect, it } from "vitest";
import { extractLegacy } from "./legacy-extract";

const row = (t: string) => `["${t}", 'Stem with \\'quote\\' and \\n newline?', "Right", "W1", "W2", "W3", \`Because "reasons".\`]`;

describe("extractLegacy", () => {
  it("parses PRE and CLI arrays without executing code", () => {
    const html = `<script>
      // comment
      const PRE = [ ${row("Anatomy")}, /* block */ ${row("Physiology")}, ];
      var CLI = [ ${row("Surgery")} ];
      alert("never run");
    </script>`;
    const { PRE, CLI } = extractLegacy(html);
    expect(PRE.map((p) => p.topic)).toEqual(["Anatomy", "Physiology"]);
    expect(CLI).toHaveLength(1);
    expect(PRE[0].stem).toBe("Stem with 'quote' and \n newline?");
    expect(PRE[0].correct).toBe("Right");
    expect(PRE[0].wrong).toEqual(["W1", "W2", "W3"]);
    expect(PRE[0].explanation).toBe('Because "reasons".');
  });

  it("rejects malformed rows with a clear message", () => {
    const html = `const PRE = [["a","b"]]; const CLI = [];`;
    expect(() => extractLegacy(html)).toThrow(/PRE\[0\] must be 7 strings/);
  });

  it("rejects template interpolation", () => {
    const html = "const PRE = [[`${evil()}`]]; const CLI = [];";
    expect(() => extractLegacy(html)).toThrow(/interpolation/);
  });

  it("errors when an array is missing", () => {
    expect(() => extractLegacy("const PRE = [];")).toThrow(/CLI not found/);
  });
});
