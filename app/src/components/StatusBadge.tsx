export function RoleBadge({ role }: { role: "konyvelo" | "adminisztrator" }) {
  return (
    <span className={`badge ${role === "konyvelo" ? "badge-primary" : "badge-neutral"}`}>
      {role === "konyvelo" ? "Könyvelő" : "Adminisztrátor"}
    </span>
  );
}

export function CompanyStatusBadge({ status }: { status: "active" | "paused" }) {
  return (
    <span className={`badge ${status === "active" ? "badge-success" : "badge-neutral"}`}>
      {status === "active" ? "Aktív" : "Szüneteltetve"}
    </span>
  );
}

const INVOICE_STATUS_LABEL: Record<string, string> = {
  synced: "Szinkronizálva",
  needs_review: "Felülvizsgálandó",
  approved: "Jóváhagyva",
  submitted: "Beküldés alatt",
  booked: "Könyvelve (IMA)",
  failed: "Hibás beküldés",
  rejected: "Elutasítva",
};

const INVOICE_STATUS_CLASS: Record<string, string> = {
  synced: "badge-info",
  needs_review: "badge-warning",
  approved: "badge-primary",
  submitted: "badge-neutral",
  booked: "badge-success",
  failed: "badge-danger",
  rejected: "badge-neutral",
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${INVOICE_STATUS_CLASS[status] ?? "badge-neutral"}`}>
      {INVOICE_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const MAPPING_RULE_SOURCE_LABEL: Record<string, string> = {
  manual: "Kézi",
  learned_invoiceanalytics: "Tanult",
  vat_mapping: "Áfa megfeleltetés",
  advance_reference: "Előleg",
};

export function MappingRuleSourceBadge({ source }: { source: string }) {
  return (
    <span className={`badge ${source === "manual" ? "badge-primary" : "badge-neutral"}`}>
      {MAPPING_RULE_SOURCE_LABEL[source] ?? source}
    </span>
  );
}
