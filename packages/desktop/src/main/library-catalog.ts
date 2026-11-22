/**
 * The user's library cards on disk (05/11/2026): `libraries.json` in the app's data folder,
 * outside any song, so the same card serves all of them. Written whole and atomically (a temporary
 * file, then rename), so a crash never leaves half a catalog.
 */
import fs from "node:fs";
import path from "node:path";
import { EMPTY_CATALOG, type LibraryCard, type LibraryCatalog, cleanCard, cleanCatalog } from "../shared/library-cards.js";

export class LibraryCatalogFile {
  private catalog: LibraryCatalog | null = null;
  private readonly listeners = new Set<(catalog: LibraryCatalog) => void>();

  constructor(private readonly file: string) {}

  read(): LibraryCatalog {
    if (!this.catalog) {
      try {
        this.catalog = cleanCatalog(JSON.parse(fs.readFileSync(this.file, "utf8")));
      } catch {
        this.catalog = structuredClone(EMPTY_CATALOG);
      }
    }
    return this.catalog;
  }

  card(id: string): LibraryCard | undefined {
    return this.read().cards.find((c) => c.id === id);
  }

  /** Adds or replaces a card (by id). Returns it as saved, or null if it is not a valid card. */
  save(input: unknown): LibraryCard | null {
    const card = cleanCard(input);
    if (!card) return null;
    const cards = this.read().cards.filter((c) => c.id !== card.id);
    cards.push(card);
    cards.sort((a, b) => a.name.localeCompare(b.name));
    this.catalog = { cards };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ format: "fourhands-libraries", version: 1, cards }, null, 2));
    fs.renameSync(tmp, this.file);
    for (const l of this.listeners) l(this.catalog);
    return card;
  }

  onChange(listener: (catalog: LibraryCatalog) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
