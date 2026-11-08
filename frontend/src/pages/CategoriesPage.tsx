import { useState } from "react";
import { deleteCategory, deleteRule, fetchRules, renameCategory } from "../api";
import CategoryDialog from "../components/CategoryDialog";
import DeleteCategoryDialog from "../components/DeleteCategoryDialog";
import DeleteRuleDialog from "../components/DeleteRuleDialog";
import { useData, useLoad } from "../data";
import { bookings, eur } from "../format";
import { useTitle } from "../router";
import { rhythmLabel, type Category, type Rule, type TxKind } from "../types";

const SECTIONS: [TxKind, string][] = [
  ["out", "Ausgaben"],
  ["in", "Einnahmen"],
  ["transfer", "Umbuchungen"],
];

/** Art der Buchungen einer gemerkten Zuordnung, bei Umbuchungen mit Richtung */
const ruleKind = ({ kind, type }: Rule) =>
  kind === "out" ? "Ausgabe" : kind === "in" ? "Einnahme" : `Umbuchung (${type === "out" ? "Abbuchung" : "Gutschrift"})`;

/** z. B. „Nur bei 21,42 € · Ausgabe → Freizeit, monatlich“ */
const ruleSummary = (rule: Rule) =>
  [
    rule.amount === null ? "Jeder Betrag" : `Nur bei ${eur.format(rule.amount)}`,
    `${ruleKind(rule)} → ${rule.category}, ${rule.rhythm ? rhythmLabel(rule.rhythm).toLowerCase() : "einmalig"}`,
  ].join(" · ");

/** Kategorien je Art anlegen, umbenennen und löschen; gemerkte Zuordnungen ansehen und löschen */
export default function CategoriesPage() {
  const { categories, createCategory, loaded, refresh } = useData();
  const rules = useLoad(fetchRules, []);
  const [creating, setCreating] = useState<TxKind | null>(null);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [forgetting, setForgetting] = useState<Rule | null>(null);
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

  const forget = async (rule: Rule) => {
    await deleteRule(rule.id);
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
                    <small>
                      {bookings(c.transactionCount)}
                      {c.auto && ` · automatisch: ${c.auto}`}
                    </small>
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
      <section>
        <h2>Gemerkte Zuordnungen</h2>
        {rules.data && rules.data.length > 0 && (
          <ul className="rows rules">
            {rules.data.map((r) => (
              <li key={r.id}>
                <div>
                  {r.counterparty}
                  <small>
                    {ruleSummary(r)} · {bookings(r.transactionCount)}
                  </small>
                </div>
                <button className="ghost small danger" onClick={() => setForgetting(r)}>
                  Löschen
                </button>
              </li>
            ))}
          </ul>
        )}
        {rules.data?.length === 0 && (
          <p className="empty">
            Noch keine. Beim Bearbeiten einer importierten Buchung lässt sich wählen, dass künftige Buchungen derselben
            Gegenpartei genauso zugeordnet werden.
          </p>
        )}
        {rules.failed && <p className="empty">Die gemerkten Zuordnungen konnten nicht geladen werden.</p>}
      </section>
      <p className="hint">
        Gemerkte Zuordnungen gelten für alle Buchungen ihrer Gegenpartei, deren Kategorie nicht von Hand gewählt ist, auch
        für bisherige. Danach werden importierte Ausgaben automatisch zugeordnet, wenn die Gegenpartei eine bekannte
        Supermarktkette ist oder die Kartenzahlung eine passende Händlerart mitbringt (MCC, z. B. bei Trade Republic). Beides
        gilt auch nach dem Umbenennen der Kategorie. Eine von Hand gewählte Kategorie bleibt, wie sie ist.
      </p>
      <p className="hint">
        „Sonstiges“ ist fest: Hier landen importierte Buchungen, die sich nicht automatisch zuordnen lassen, und beim
        Löschen einer Kategorie ist es die Vorauswahl für ihre Buchungen.
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
      {forgetting && (
        <DeleteRuleDialog
          key={forgetting.id}
          rule={forgetting}
          summary={ruleSummary(forgetting)}
          onDelete={() => forget(forgetting)}
          onClose={() => setForgetting(null)}
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
