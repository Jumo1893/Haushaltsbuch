import { useState } from "react";
import { deleteCategory, renameCategory } from "../api";
import CategoryDialog from "../components/CategoryDialog";
import DeleteCategoryDialog from "../components/DeleteCategoryDialog";
import { useData } from "../data";
import { bookings } from "../format";
import { useTitle } from "../router";
import type { Category, TxKind } from "../types";

const SECTIONS: [TxKind, string][] = [
  ["out", "Ausgaben"],
  ["in", "Einnahmen"],
  ["transfer", "Umbuchungen"],
];

/** Kategorien je Art anlegen, umbenennen und löschen */
export default function CategoriesPage() {
  const { categories, createCategory, loaded, refresh } = useData();
  const [creating, setCreating] = useState<TxKind | null>(null);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  useTitle("Kategorien");

  if (!loaded) return null;

  // Fehler beim Speichern zeigen die Dialoge selbst an
  const rename = async (category: Category, name: string) => {
    await renameCategory(category.id, name);
    refresh();
  };

  const remove = async (category: Category, moveTo: number) => {
    await deleteCategory(category.id, moveTo);
    refresh();
  };

  return (
    <>
      <div className="page-head">
        <h1>Kategorien</h1>
      </div>
      {SECTIONS.map(([kind, title]) => (
        <section key={kind}>
          <div className="section-head">
            <h2>{title}</h2>
            <button className="ghost small" onClick={() => setCreating(kind)}>
              + Kategorie anlegen
            </button>
          </div>
          <ul className="rows">
            {categories
              .filter((c) => c.kind === kind)
              .map((c) => (
                <li key={c.id}>
                  <div>
                    {c.name}
                    <small>{bookings(c.transactionCount)}</small>
                  </div>
                  {c.fixed ? (
                    <span className="badge">Fest</span>
                  ) : (
                    <div className="head-actions">
                      <button className="ghost small" onClick={() => setRenaming(c)}>
                        Umbenennen
                      </button>
                      <button className="ghost small danger" onClick={() => setDeleting(c)}>
                        Löschen
                      </button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
      <p className="hint">
        „Sonstiges“ ist fest: Hier landen importierte Buchungen, und beim Löschen einer Kategorie ist es die Vorauswahl
        für ihre Buchungen.
      </p>

      {creating && (
        <CategoryDialog
          onSave={async (name) => {
            await createCategory({ kind: creating, name });
          }}
          onClose={() => setCreating(null)}
        />
      )}
      {renaming && (
        <CategoryDialog
          key={renaming.id}
          name={renaming.name}
          onSave={(name) => rename(renaming, name)}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <DeleteCategoryDialog
          key={deleting.id}
          category={deleting}
          targets={categories.filter((c) => c.kind === deleting.kind && c.id !== deleting.id)}
          onDelete={(moveTo) => remove(deleting, moveTo)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
