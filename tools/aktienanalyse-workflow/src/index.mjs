import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { extractToolResults, extractModelText } from "./mcp-extract.mjs";
import { buildFullReport } from "./report-template.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MCP_BETA_HEADER = "mcp-client-2025-11-20";

const BIGDATA_MCP = {
  type: "url",
  url: process.env.BIGDATA_MCP_URL || "https://mcp.bigdata.com",
  name: "bigdata",
  authorization_token: process.env.BIGDATA_AUTH_TOKEN,
};

// Jeder MCP-Server muss von genau einem MCPToolset im "tools"-Array
// referenziert werden, sonst lehnt die Messages API den Request ab.
const BIGDATA_TOOLS = [{ type: "mcp_toolset", mcp_server_name: "bigdata" }];

const KATEGORIEN = [
  { label: "Sell-Side-Analysten", suchbegriff: (name) => `${name} analyst price target rating update` },
  { label: "Ratingagenturen", suchbegriff: (name) => `${name} credit rating outlook Moody's S&P Fitch` },
  { label: "Makro/Zentralbanken & Wirtschaftsforschung", suchbegriff: (name) => `${name} sector macro rate outlook` },
  { label: "Index-/Datenprovider", suchbegriff: (name) => `${name} ESG rating index weighting consensus` },
  { label: "Quant/Asset-Manager-Research", suchbegriff: (name) => `${name} institutional ownership fund flows` },
];

/**
 * PHASE 1: Recherche. Ein Tool-erzwingender Call pro Schritt, damit wir
 * kontrolliert wissen, welches Tool mit welchem Ergebnis kam - statt dem
 * Modell freie Hand ueber mehrere Schritte in einem Call zu lassen.
 */
async function rechercheSchritt(anweisung) {
  const res = await anthropic.beta.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    mcp_servers: [BIGDATA_MCP],
    tools: BIGDATA_TOOLS,
    betas: [MCP_BETA_HEADER],
    messages: [{ role: "user", content: anweisung }],
  });
  return extractToolResults(res);
}

async function rechercheAlleKategorien(name) {
  const entity = await rechercheSchritt(
    `Nutze find_securities um "${name}" zu einer Entitaet aufzuloesen. Nur den Tool-Call ausfuehren.`
  );

  const tearsheet = await rechercheSchritt(
    `Nutze bigdata_company_tearsheet fuer "${name}". Nur den Tool-Call ausfuehren.`
  );

  const sentiment = await rechercheSchritt(
    `Nutze bigdata_sentiment_tearsheet fuer "${name}". Nur den Tool-Call ausfuehren.`
  );

  const kategorieErgebnisse = {};
  for (const k of KATEGORIEN) {
    const treffer = await rechercheSchritt(
      `Nutze bigdata_search mit der Anfrage "${k.suchbegriff(name)}". Nur den Tool-Call ausfuehren.`
    );
    kategorieErgebnisse[k.label] = treffer;
  }

  return { entity, tearsheet, sentiment, kategorieErgebnisse };
}

/**
 * PHASE 3: Synthese. Bekommt AUSSCHLIESSLICH das recherchierte JSON als
 * Kontext - System-Prompt verbietet explizit externes Wissen.
 */
async function syntheseErzeugen(name, recherche) {
  const system = `Du erstellst NUR die "Gesamtbeurteilung" fuer eine Aktienanalyse.
Nutze AUSSCHLIESSLICH die im User-Message mitgelieferten recherchierten Daten (JSON).
Erfinde KEINE Fakten, Kurse, Ratings oder Ereignisse, die nicht in den Daten stehen.
Wenn die Daten fuer einen Punkt (z.B. Bull Case) nicht ausreichen, schreibe das explizit.
Gliedere in: Kursentwicklung, Einflussfaktoren, Bull Case, Bear Case, Ausblick,
Empfehlung (kurzfristig/mittelfristig/langfristig: Buy/Hold/Sell).`;

  const res = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    system,
    messages: [
      {
        role: "user",
        content: `Recherchierte Daten fuer ${name}:\n\n${JSON.stringify(recherche, null, 2)}`,
      },
    ],
  });
  return extractModelText(res);
}

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Nutzung: node src/index.mjs <Ticker oder Firmenname>");
    process.exit(1);
  }

  console.log(`Recherchiere ${name} ueber Bigdata.com...`);
  const recherche = await rechercheAlleKategorien(name);

  console.log("Erzeuge Synthese (eingeschraenkt auf recherchierte Daten)...");
  const synthese = await syntheseErzeugen(name, recherche);

  // Perspektiven-Abschnitte werden hier bewusst NUR aus rohen JSON-Feldern
  // gebaut (siehe report-template.mjs) - kein LLM-Freitext fuer Fakten.
  const perspektiven = {};
  for (const k of KATEGORIEN) {
    perspektiven[k.label] = (recherche.kategorieErgebnisse[k.label] || [])
      .filter((r) => r.kind === "result" && !r.is_error)
      .map((r) => ({ summary: r.raw_text?.slice(0, 300) || "(kein Text)", source: "Bigdata.com" }));
  }

  const report = buildFullReport({
    entityName: name,
    kurzeinordnung: "(aus Tearsheet-Rohdaten ableiten - TODO Claude Code)",
    perspektiven,
    synthese,
    quellen: ["Bigdata.com company tearsheet", "Bigdata.com sentiment tearsheet", "Bigdata.com search"],
  });

  const outPath = `report-${name.replace(/\s+/g, "_")}.md`;
  fs.writeFileSync(outPath, report, "utf-8");
  console.log(`Fertig: ${outPath}`);
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
