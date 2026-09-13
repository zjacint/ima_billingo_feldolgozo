"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MappingRuleSourceBadge } from "@/components/StatusBadge";
import CodeNameCombobox, { type CodeNameOption } from "@/components/CodeNameCombobox";
import Spinner from "@/components/Spinner";

/**
 * A tanult szabályok `productNamePattern`-je sok, " | "-lal összefűzött
 * terméknevet tartalmazhat (ld. mappingRuleEngine.ts `learnFromInvoiceAnalytics`,
 * `bucket.productNames.join(" | ")`) — a listázó táblázatban ez
 * átláthatatlanná tenné a sort. Itt csak az első néhányat mutatjuk, a
 * teljes mintalista a sor "Szerkesztés" gombjával nyíló modálban látszik.
 */
const PRODUCT_PATTERN_PREVIEW_COUNT = 3;

function ProductNamePatternPreview({ pattern }: { pattern: string | null }) {
  if (!pattern) return <>—</>;
  const parts = pattern.split(" | ");
  if (parts.length <= PRODUCT_PATTERN_PREVIEW_COUNT) return <>{pattern}</>;
  const shown = parts.slice(0, PRODUCT_PATTERN_PREVIEW_COUNT).join(" | ");
  return (
    <span title={pattern}>
      {shown} <span className="muted">(+{parts.length - PRODUCT_PATTERN_PREVIEW_COUNT} további)</span>
    </span>
  );
}

interface RuleRow {
  id: string;
  partnerId: string | null;
  partnerName: string | null;
  productNamePattern: string | null;
  commentPattern: string | null;
  documentTypePattern: string | null;
  vatPattern: string | null;
  glaCode: string;
  vatCode: string;
  /** Külön ÁFA főkönyvi szám, csak megjelenítésre/ellenőrzésre — ld. docs/tervezes.md 8.3. */
  vatGlaCode: string | null;
  amountSign: "original" | "negative";
  note: string | null;
  source: "learned_invoiceanalytics" | "manual";
  confidence: number | null;
  active: boolean;
  /** Mikor illesztette utoljára a javaslati motor egy tényleges számlasorra — null, ha soha. */
  lastMatchedAt: string | null;
}

interface PartnerOption {
  id: string;
  name: string;
}

/**
 * A szabály feltételeinek szerkesztő űrlapja — a "Karbantartás" táblázat
 * csak olvasható, a szerkesztés egy fókuszált modalban nyílik meg,
 * egy-egy szabályra. Ugyanazt a mezőkészletet használja, mint az "Új
 * kézi szabály" form, csak előre kitöltve.
 *
 * Ha minden sorban külön input/select/combobox lenne egyszerre
 * renderelve (akár 50 sor × 6-7 widget), a 13+ oszlopos táblázat nagy
 * monitoron sem férne ki, és feleslegesen sok interaktív DOM-elemet/React
 * state-et hozna létre egyszerre. A lista ezért csak sima szöveget
 * renderel, a szerkesztés egy darab, egyszerre csak egy szabályra
 * megnyíló panelben történik.
 */
function RuleEditModal({
  rule,
  partners,
  glaAccountOptions,
  vatKeyOptions,
  onClose,
  onSave,
  onDelete,
}: {
  rule: RuleRow;
  partners: PartnerOption[];
  glaAccountOptions: CodeNameOption[];
  vatKeyOptions: CodeNameOption[];
  onClose: () => void;
  onSave: (id: string, data: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [partnerId, setPartnerId] = useState(rule.partnerId ?? "");
  const [productNamePattern, setProductNamePattern] = useState(rule.productNamePattern ?? "");
  const [commentPattern, setCommentPattern] = useState(rule.commentPattern ?? "");
  const [documentTypePattern, setDocumentTypePattern] = useState(rule.documentTypePattern ?? "");
  const [vatPattern, setVatPattern] = useState(rule.vatPattern ?? "");
  const [glaCode, setGlaCode] = useState(rule.glaCode);
  const [vatCode, setVatCode] = useState(rule.vatCode);
  const [vatGlaCode, setVatGlaCode] = useState(rule.vatGlaCode ?? "");
  const [amountSign, setAmountSign] = useState<"original" | "negative">(rule.amountSign);
  const [note, setNote] = useState(rule.note ?? "");
  const [active, setActive] = useState(rule.active);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCondition = Boolean(partnerId || productNamePattern || commentPattern || documentTypePattern || vatPattern);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(rule.id, {
        partnerId: partnerId || null,
        productNamePattern: productNamePattern || null,
        commentPattern: commentPattern || null,
        documentTypePattern: documentTypePattern || null,
        vatPattern: vatPattern || null,
        glaCode,
        vatCode,
        vatGlaCode: vatGlaCode || null,
        amountSign,
        note: note || null,
        active,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Biztosan törlöd ezt a szabályt?")) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(rule.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="card-title">Szabály szerkesztése</div>
        <div className="form-grid">
          <label className="field">
            Partner (pontos egyezés)
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">— nincs —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Termék/szolgáltatás névminta
            <input
              type="text"
              value={productNamePattern}
              onChange={(e) => setProductNamePattern(e.target.value)}
              placeholder="pl. tanácsadás"
            />
          </label>
          <label className="field">
            Megjegyzés minta (tétel VAGY számla fejléc)
            <input
              type="text"
              value={commentPattern}
              onChange={(e) => setCommentPattern(e.target.value)}
              placeholder="pl. garanciális visszatartás|jóteljesítési garancia"
            />
          </label>
          <label className="field">
            Bizonylattípus minta
            <input
              type="text"
              value={documentTypePattern}
              onChange={(e) => setDocumentTypePattern(e.target.value)}
              placeholder="pl. advance"
            />
          </label>
          <label className="field">
            Áfa kulcs/kód minta
            <input type="text" value={vatPattern} onChange={(e) => setVatPattern(e.target.value)} placeholder="pl. F.AFA" />
          </label>
          <label className="field">
            Árbevétel kontír (GL kód)
            <CodeNameCombobox value={glaCode} onChange={setGlaCode} options={glaAccountOptions} />
          </label>
          <label className="field">
            Áfa kulcs (IMA)
            <CodeNameCombobox value={vatCode} onChange={setVatCode} options={vatKeyOptions} placeholder="pl. 27% vagy ÁKK" />
          </label>
          <label className="field">
            Áfa kontír (opcionális)
            <CodeNameCombobox value={vatGlaCode} onChange={setVatGlaCode} options={glaAccountOptions} placeholder="pl. 4671" />
          </label>
          <label className="field">
            Összeg előjele
            <select value={amountSign} onChange={(e) => setAmountSign(e.target.value as "original" | "negative")}>
              <option value="original">Eredeti</option>
              <option value="negative">Negatív (pl. garanciális visszatartás)</option>
            </select>
          </label>
          <label className="field">
            Megjegyzés a szabályhoz (opcionális)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="miért létezik ez a szabály" />
          </label>
        </div>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktív
        </label>
        {error && <p className="alert alert-error">{error}</p>}
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <button className="btn btn-sm btn-danger" onClick={handleDelete} disabled={saving || deleting}>
            {deleting ? (
              <>
                <Spinner /> Törlés…
              </>
            ) : (
              "Törlés"
            )}
          </button>
          <div className="cluster">
            <button className="btn btn-sm" onClick={onClose} disabled={saving || deleting}>
              Mégse
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleSave}
              disabled={saving || deleting || !glaCode || !vatCode || !hasCondition}
            >
              {saving ? (
                <>
                  <Spinner /> Mentés…
                </>
              ) : (
                "Mentés"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const NO_CHANGE = "__no_change__";

/**
 * Csoportos módosítás a kijelölt szabályokra — ld. docs/tervezes.md 10.
 * fejezet. Minden mező alapból "nem módosítom" állapotú — csak azok a
 * mezők mennek ki a kérésben, amiket a felhasználó ténylegesen kitöltött/
 * megváltoztatott, a többi szabály értéke érintetlen marad.
 */
function BulkEditModal({
  count,
  glaAccountOptions,
  vatKeyOptions,
  onClose,
  onSave,
}: {
  count: number;
  glaAccountOptions: CodeNameOption[];
  vatKeyOptions: CodeNameOption[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [glaCode, setGlaCode] = useState("");
  const [vatCode, setVatCode] = useState("");
  const [vatGlaCode, setVatGlaCode] = useState("");
  const [amountSign, setAmountSign] = useState(NO_CHANGE);
  const [active, setActive] = useState(NO_CHANGE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnyChange = Boolean(glaCode || vatCode || vatGlaCode || amountSign !== NO_CHANGE || active !== NO_CHANGE);

  async function handleSave() {
    const data: Record<string, unknown> = {};
    if (glaCode) data.glaCode = glaCode;
    if (vatCode) data.vatCode = vatCode;
    if (vatGlaCode) data.vatGlaCode = vatGlaCode;
    if (amountSign !== NO_CHANGE) data.amountSign = amountSign;
    if (active !== NO_CHANGE) data.active = active === "true";

    setSaving(true);
    setError(null);
    try {
      await onSave(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="card-title">Csoportos módosítás ({count} szabály)</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          Csak a ténylegesen kitöltött mezők módosulnak a kijelölt szabályokon — az üresen
          hagyott mezők nem változnak.
        </p>
        <div className="form-grid">
          <label className="field">
            Árbevétel kontír (GL kód)
            <CodeNameCombobox value={glaCode} onChange={setGlaCode} options={glaAccountOptions} placeholder="— nem módosítom —" />
          </label>
          <label className="field">
            Áfa kulcs (IMA)
            <CodeNameCombobox value={vatCode} onChange={setVatCode} options={vatKeyOptions} placeholder="— nem módosítom —" />
          </label>
          <label className="field">
            Áfa kontír (opcionális)
            <CodeNameCombobox value={vatGlaCode} onChange={setVatGlaCode} options={glaAccountOptions} placeholder="— nem módosítom —" />
          </label>
          <label className="field">
            Összeg előjele
            <select value={amountSign} onChange={(e) => setAmountSign(e.target.value)}>
              <option value={NO_CHANGE}>— nem módosítom —</option>
              <option value="original">Eredeti</option>
              <option value="negative">Negatív</option>
            </select>
          </label>
          <label className="field">
            Aktív
            <select value={active} onChange={(e) => setActive(e.target.value)}>
              <option value={NO_CHANGE}>— nem módosítom —</option>
              <option value="true">Aktív</option>
              <option value="false">Inaktív</option>
            </select>
          </label>
        </div>
        {error && <p className="alert alert-error">{error}</p>}
        <div className="cluster" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving}>
            Mégse
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || !hasAnyChange}>
            {saving ? (
              <>
                <Spinner /> Mentés…
              </>
            ) : (
              `Alkalmazás ${count} szabályra`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RulesEditor({
  companyId,
  partners,
  glaAccountOptions,
  vatKeyOptions,
  rules,
  totalRuleCount,
}: {
  companyId: string;
  partners: PartnerOption[];
  glaAccountOptions: CodeNameOption[];
  vatKeyOptions: CodeNameOption[];
  rules: RuleRow[];
  totalRuleCount: number;
}) {
  const router = useRouter();
  const [partnerId, setPartnerId] = useState("");
  const [productNamePattern, setProductNamePattern] = useState("");
  const [commentPattern, setCommentPattern] = useState("");
  const [documentTypePattern, setDocumentTypePattern] = useState("");
  const [vatPattern, setVatPattern] = useState("");
  const [glaCode, setGlaCode] = useState("");
  const [vatCode, setVatCode] = useState("");
  const [vatGlaCode, setVatGlaCode] = useState("");
  const [amountSign, setAmountSign] = useState<"original" | "negative">("original");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState<"consolidate" | "bulk-delete" | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  const hasCondition = Boolean(partnerId || productNamePattern || commentPattern || documentTypePattern || vatPattern);
  const neverUsedRuleIds = rules.filter((r) => !r.lastMatchedAt).map((r) => r.id);
  const editingRule = rules.find((r) => r.id === editingRuleId) ?? null;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectNeverUsed() {
    setSelected(new Set(neverUsedRuleIds));
  }

  async function consolidateDuplicates() {
    setCleanupBusy("consolidate");
    setCleanupMessage(null);
    setError(null);
    try {
      // Csomagonként (kérésenként 20 szabály-csoport) fut, ugyanazon okból,
      // mint a szinkron/javaslat-újraszámolás — ld. docs/tervezes.md 9.4.
      let cursor: Record<string, unknown> | null = null;
      let lastMergedGroups = 0;
      let lastDeletedRules = 0;
      for (;;) {
        const res: Response = await fetch(`/api/companies/${companyId}/rules/consolidate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        });
        const body: Record<string, any> = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Sikertelen összevonás (${res.status})`);
        lastMergedGroups = body.mergedGroups;
        lastDeletedRules = body.deletedRules;
        setCleanupMessage(`Összevonás folyamatban… ${body.mergedGroups} csoport eddig.`);
        if (body.done) break;
        cursor = body.cursor;
      }
      setCleanupMessage(
        `${lastMergedGroups} csoport összevonva, ${lastDeletedRules} felesleges (partner-specifikus) szabály törölve.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setCleanupBusy(null);
    }
  }

  async function bulkDeleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Biztosan törlöd a kijelölt ${selected.size} szabályt?`)) return;
    setCleanupBusy("bulk-delete");
    setCleanupMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/rules/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleIds: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen törlés (${res.status})`);
      setCleanupMessage(`${body.deleted} szabály törölve.`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setCleanupBusy(null);
    }
  }

  async function bulkUpdateSelected(data: Record<string, unknown>) {
    const res = await fetch(`/api/companies/${companyId}/rules/bulk-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleIds: [...selected], data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Sikertelen módosítás (${res.status})`);
    setCleanupMessage(`${body.updated} szabály módosítva.`);
    setShowBulkEdit(false);
    router.refresh();
  }

  async function createRule() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: partnerId || null,
          productNamePattern: productNamePattern || null,
          commentPattern: commentPattern || null,
          documentTypePattern: documentTypePattern || null,
          vatPattern: vatPattern || null,
          glaCode,
          vatCode,
          vatGlaCode: vatGlaCode || null,
          amountSign,
          note: note || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen létrehozás (${res.status})`);
      setPartnerId("");
      setProductNamePattern("");
      setCommentPattern("");
      setDocumentTypePattern("");
      setVatPattern("");
      setGlaCode("");
      setVatCode("");
      setVatGlaCode("");
      setAmountSign("original");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function patchRule(id: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/companies/${companyId}/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Sikertelen módosítás (${res.status})`);
    }
    router.refresh();
  }

  async function saveRuleFromModal(id: string, data: Record<string, unknown>) {
    await patchRule(id, data);
    setEditingRuleId(null);
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/companies/${companyId}/rules/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Sikertelen törlés (${res.status})`);
    }
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setEditingRuleId(null);
    router.refresh();
  }

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="card-title">Karbantartás</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A lista lapozott ({rules.length} szabály ezen az oldalon, {totalRuleCount} összesen) — a
          kijelölés és a &bdquo;Sosem használt kijelölése&rdquo; is csak a jelenleg megjelenő oldalra
          vonatkozik. A &bdquo;Duplikátumok összevonása&rdquo; viszont az ÖSSZES szabályon fut,
          függetlenül az oldalazástól. A tanult szabályoknál gyakori, hogy csak a partner tér el,
          egyébként ugyanazt a tranzakciót fedik le — ezeket a &bdquo;Duplikátumok
          összevonása&rdquo; gomb egy közös (partner nélküli) szabállyá vonja
          össze. A &bdquo;Sosem használt&rdquo; kijelölés azokat a szabályokat
          jelöli ki, amelyek a létrehozásuk óta még EGYETLEN számlasorra sem
          illeszkedtek — ezeket biztonságos gyorsan törölni. A &bdquo;Csoportos
          módosítás&rdquo; gombbal a kijelölt szabályokon egyszerre módosítható a
          kontír, az áfa kulcs, az áfa kontír, az előjel és az aktív állapot —
          csak a ténylegesen kitöltött mezők változnak.
        </p>
        <div className="cluster">
          <button
            className="btn btn-sm"
            onClick={consolidateDuplicates}
            disabled={cleanupBusy !== null}
          >
            {cleanupBusy === "consolidate" ? (
              <>
                <Spinner /> Összevonás…
              </>
            ) : (
              "Duplikátumok összevonása"
            )}
          </button>
          <button
            className="btn btn-sm"
            onClick={selectNeverUsed}
            disabled={cleanupBusy !== null || neverUsedRuleIds.length === 0}
          >
            Sosem használt kijelölése ({neverUsedRuleIds.length})
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setShowBulkEdit(true)}
            disabled={cleanupBusy !== null || selected.size === 0}
          >
            Csoportos módosítás ({selected.size})
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={bulkDeleteSelected}
            disabled={cleanupBusy !== null || selected.size === 0}
          >
            {cleanupBusy === "bulk-delete" ? (
              <>
                <Spinner /> Törlés…
              </>
            ) : (
              `Kijelöltek törlése (${selected.size})`
            )}
          </button>
        </div>
        {cleanupMessage && <p className="alert alert-success" style={{ margin: 0 }}>{cleanupMessage}</p>}
        {error && <p className="alert alert-error" style={{ margin: 0 }}>{error}</p>}
      </div>

      <div className="card stack">
        <div className="card-title">Új kézi szabály</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A kitöltött feltételek ÉS kapcsolatban vannak — minél többet töltesz
          ki, a szabály annál specifikusabb, és annál inkább elsőbbséget élvez
          más, kevésbé specifikus szabályokkal szemben (ld. docs/tervezes.md
          9.3). A megjegyzés/termék/áfa mezőkben `|` karakterrel több
          alternatíva is megadható (VAGY kapcsolat), pl.{" "}
          <code>garanciális visszatartás|jóteljesítési garancia</code>.
        </p>
        <div className="form-grid">
          <label className="field">
            Partner (pontos egyezés)
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">— nincs —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Termék/szolgáltatás névminta
            <input
              type="text"
              value={productNamePattern}
              onChange={(e) => setProductNamePattern(e.target.value)}
              placeholder="pl. tanácsadás"
            />
          </label>
          <label className="field">
            Megjegyzés minta (tétel VAGY számla fejléc)
            <input
              type="text"
              value={commentPattern}
              onChange={(e) => setCommentPattern(e.target.value)}
              placeholder="pl. garanciális visszatartás|jóteljesítési garancia"
            />
          </label>
          <label className="field">
            Bizonylattípus minta
            <span className="field-hint">Billingo `Document.type` értéke, pl. „advance” (előlegszámla).</span>
            <input
              type="text"
              value={documentTypePattern}
              onChange={(e) => setDocumentTypePattern(e.target.value)}
              placeholder="pl. advance"
            />
          </label>
          <label className="field">
            Áfa kulcs/kód minta
            <span className="field-hint">A Billingo tétel áfa értéke, pl. „F.AFA” (fordított áfa).</span>
            <input type="text" value={vatPattern} onChange={(e) => setVatPattern(e.target.value)} placeholder="pl. F.AFA" />
          </label>
          <label className="field">
            Árbevétel kontír (GL kód)
            <CodeNameCombobox value={glaCode} onChange={setGlaCode} options={glaAccountOptions} />
          </label>
          <label className="field">
            Áfa kulcs (IMA)
            <CodeNameCombobox
              value={vatCode}
              onChange={setVatCode}
              options={vatKeyOptions}
              placeholder="pl. 27% vagy ÁKK"
            />
          </label>
          <label className="field">
            Áfa kontír (opcionális)
            <span className="field-hint">
              Külön főkönyvi szám az ÁFA postázásához, csak megjelenítésre — pl. „4671”.
            </span>
            <CodeNameCombobox value={vatGlaCode} onChange={setVatGlaCode} options={glaAccountOptions} placeholder="pl. 4671" />
          </label>
          <label className="field">
            Összeg előjele
            <select value={amountSign} onChange={(e) => setAmountSign(e.target.value as "original" | "negative")}>
              <option value="original">Eredeti</option>
              <option value="negative">Negatív (pl. garanciális visszatartás)</option>
            </select>
          </label>
          <label className="field">
            Megjegyzés a szabályhoz (opcionális)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="miért létezik ez a szabály" />
          </label>
        </div>
        <div>
          <button className="btn btn-primary" onClick={createRule} disabled={submitting || !glaCode || !vatCode || !hasCondition}>
            Létrehozás
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={rules.length > 0 && rules.every((r) => selected.has(r.id))}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(rules.map((r) => r.id)) : new Set())
                  }
                />
              </th>
              <th>Partner</th>
              <th>Termékminta</th>
              <th>Megjegyzésminta</th>
              <th>Bizonylattípus</th>
              <th>Áfa minta</th>
              <th>Árbevétel kontír</th>
              <th>Áfa</th>
              <th>Áfa kontír</th>
              <th>Előjel</th>
              <th>Forrás</th>
              <th>Utoljára használva</th>
              <th>Aktív</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} />
                </td>
                <td>{r.partnerName ?? <span className="muted">— nincs —</span>}</td>
                <td>
                  <ProductNamePatternPreview pattern={r.productNamePattern} />
                </td>
                <td>{r.commentPattern ?? "—"}</td>
                <td>{r.documentTypePattern ?? "—"}</td>
                <td>
                  {r.vatPattern ?? "—"}
                  {r.note && <div className="muted text-sm">{r.note}</div>}
                </td>
                <td>{r.glaCode}</td>
                <td>{r.vatCode}</td>
                <td>{r.vatGlaCode ?? "—"}</td>
                <td>{r.amountSign === "negative" ? "Negatív" : "Eredeti"}</td>
                <td>
                  <MappingRuleSourceBadge source={r.source} />
                  {r.confidence != null && (
                    <span className="muted text-sm"> ({Math.round(r.confidence * 100)}%)</span>
                  )}
                </td>
                <td className={r.lastMatchedAt ? "text-sm" : "text-sm muted"}>
                  {r.lastMatchedAt ? new Date(r.lastMatchedAt).toLocaleDateString("hu-HU") : "Sosem"}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={(e) =>
                      patchRule(r.id, { active: e.target.checked }).catch((err) =>
                        setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.")
                      )
                    }
                  />
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditingRuleId(r.id)}>
                    Szerkesztés
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={14} className="muted">
                  Még nincs szabály.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingRule && (
        <RuleEditModal
          rule={editingRule}
          partners={partners}
          glaAccountOptions={glaAccountOptions}
          vatKeyOptions={vatKeyOptions}
          onClose={() => setEditingRuleId(null)}
          onSave={saveRuleFromModal}
          onDelete={deleteRule}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          count={selected.size}
          glaAccountOptions={glaAccountOptions}
          vatKeyOptions={vatKeyOptions}
          onClose={() => setShowBulkEdit(false)}
          onSave={bulkUpdateSelected}
        />
      )}
    </div>
  );
}
