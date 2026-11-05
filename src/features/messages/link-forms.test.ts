import { expect, it } from "vitest";
import { angleLink } from "./link-forms";

const url = "https://example.test/a";

it("rewrites only the chosen occurrence of a repeated URL", () => {
  const source = `${url} then ${url} then ${url}`;
  expect(angleLink(source, { url, written: "bare", occurrence: 1 })).toBe(
    `${url} then <${url}> then ${url}`,
  );
});

it("counts occurrences past links written other ways", () => {
  const source = `<${url}> [${url}](${url}) ${url}`;
  expect(angleLink(source, { url, written: "labeled", occurrence: 1 })).toBe(
    `<${url}> <${url}> ${url}`,
  );
  expect(angleLink(source, { url, written: "bare", occurrence: 2 })).toBe(
    `<${url}> [${url}](${url}) <${url}>`,
  );
});

it("leaves code spans and blocks alone", () => {
  const source = `\`${url}\`\n\n\`\`\`\n${url}\n\`\`\`\n\n    ${url}\n\n${url}`;
  expect(angleLink(source, { url, written: "bare", occurrence: 0 })).toBe(
    `\`${url}\`\n\n\`\`\`\n${url}\n\`\`\`\n\n    ${url}\n\n<${url}>`,
  );
  expect(
    angleLink(source, { url, written: "bare", occurrence: 1 }),
  ).toBeUndefined();
});

it("writes a scheme-less address with its scheme", () => {
  expect(
    angleLink("see www.example.test.", {
      url: "http://www.example.test",
      written: "bare",
      occurrence: 0,
    }),
  ).toBe("see <http://www.example.test>.");
});

it("keeps surrounding Markdown", () => {
  expect(
    angleLink(`**bold** ${url}, _more_`, {
      url,
      written: "bare",
      occurrence: 0,
    }),
  ).toBe(`**bold** <${url}>, _more_`);
});

it.each([
  ["a link already in angle brackets", `<${url}>`, "angle"],
  ["a labeled link whose label differs", `[docs](${url})`, "labeled"],
  ["a different written form than the one asked", `[${url}](${url})`, "bare"],
  ["a link that is not there", "no link", "bare"],
] as const)("declines %s", (_name, source, written) => {
  expect(angleLink(source, { url, written, occurrence: 0 })).toBeUndefined();
});

it("declines a destination that cannot sit in angle brackets", () => {
  const spaced = "https://example.test/a%20b";
  expect(
    angleLink(`[${spaced}](<https://example.test/a b>)`, {
      url: spaced,
      written: "labeled",
      occurrence: 0,
    }),
  ).toBeUndefined();
});
