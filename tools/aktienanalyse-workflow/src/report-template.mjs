/**
 * Baut die 5 Perspektiven-Abschnitte rein aus den recherchierten
 * Rohdaten (kein LLM-Freitext). Wenn zu einer Kategorie kein Treffer
 * vorliegt, wird das explizit ausgewiesen statt etwas zu erfinden.
 */
export function buildFactSection(label, findings) {
  if (!findings || findings.length === 0) {
    return `### ${label}\n\n_Keine aktuellen öffentlichen Daten gefunden._\n`;
  }

  const lines = findings.map((f) => {
    const datum = f.date ? ` (${f.date})` : "";
    const quelle = f.source ? ` — Quelle: ${f.source}${datum}` : "";
    return `- ${f.summary}${quelle}`;
  });

  return `### ${label}\n\n${lines.join("\n")}\n`;
}

export function buildFullReport({ entityName, kurzeinordnung, perspektiven, synthese, quellen }) {
  const sections = Object.entries(perspektiven)
    .map(([label, findings]) => buildFactSection(label, findings))
    .join("\n");

  return `# Aktienanalyse: ${entityName}

## Kurzeinordnung
${kurzeinordnung}

## Perspektiven (recherchiert)
${sections}

## Gesamtbeurteilung (Synthese, auf Basis obiger Daten)
${synthese}

## Quellen
${quellen.map((q) => `- ${q}`).join("\n")}

---
*Dies ist keine Anlageberatung.*
`;
}
