import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeChunk } from "./types";

/** Только knowledge/*.md, без ссылок на личные data/profile.md и data/log.md. */
export function loadKnowledgeChunks(): KnowledgeChunk[] {
  const directory = join(process.cwd(), "knowledge");
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".md"))
    .map((file) => file.name).sort();
  const chunks: KnowledgeChunk[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const text = readFileSync(join(directory, file), "utf8").replace(/\r\n/g, "\n");
    const sections = [...text.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
    if (!sections.length) throw new Error(`${file}: нет секций с ##`);
    for (const [index, section] of sections.entries()) {
      const heading = section[1].trim();
      const content = text.slice(section.index, sections[index + 1]?.index ?? text.length).trim();
      if (!text.slice(section.index! + section[0].length, sections[index + 1]?.index ?? text.length).trim()) {
        throw new Error(`${file}: пустая секция ${heading}`);
      }
      const id = createHash("sha256").update(`${file}\n${heading}`).digest("hex");
      if (ids.has(id)) throw new Error(`${file}: повторяется заголовок ${heading}`);
      ids.add(id);
      chunks.push({ id, file, heading, content });
    }
  }
  if (!chunks.length) throw new Error("knowledge/ пуст; существующий индекс не изменён");
  return chunks;
}
