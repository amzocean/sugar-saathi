export type ContextDraft = { profile: string; nutrition: string };

export function extractContext(markdown: string): ContextDraft {
  if (new TextEncoder().encode(markdown).length > 80_000) throw new Error("Choose a Markdown file no larger than 80 KB.");
  const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  function section(letter: string) {
    const heading = new RegExp(`^## ${letter}\\. [^\\n]*\\n`, "m").exec(text);
    if (!heading) throw new Error("The document needs sections '## B.' (profile) and '## C.' (food reference). Nothing was saved.");
    const value = text.slice(heading.index + heading[0].length).split(/^## /m)[0].trim();
    if (!value || value.length > 16_000) throw new Error("Each context section must contain between 1 and 16,000 characters.");
    return value;
  }
  return { profile: section("B"), nutrition: section("C") };
}
