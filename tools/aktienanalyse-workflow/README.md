# Aktienanalyse-Workflow (Bigdata.com + Anthropic API)

## Idee / Architektur

Das Problem mit einem reinen Prompt: Am Ende schreibt das Modell trotzdem
Freitext, und Freitext kann immer leicht "aus dem Gedächtnis ergänzen".
Dieses Skript umgeht das strukturell mit einem **Zwei-Phasen-Ansatz**:

```
Phase 1: RECHERCHE (Tool-Calls, deterministisch ausgelesen)
  find_securities        -> rp_entity_id ermitteln
  bigdata_company_tearsheet -> Kennzahlen, Ratings, Kursziele, ESG
  bigdata_sentiment_tearsheet -> aktuelles Sentiment
  bigdata_search (x5)    -> je Kategorie eine gezielte Suche
      -> Ergebnisse werden NICHT vom Modell paraphrasiert,
         sondern direkt aus den mcp_tool_result-Blöcken als
         strukturiertes JSON extrahiert.

Phase 2: FAKTEN-TEMPLATE (kein LLM)
  -> report-template.js baut die 5 Perspektiven-Abschnitte
     rein aus dem JSON von Phase 1 zusammen (Titel, Quelle, Datum,
     Kernaussage laut Rohdaten).

Phase 3: SYNTHESE (ein einziger, eng eingeschränkter LLM-Call)
  -> Bekommt NUR das JSON aus Phase 1 als Kontext.
  -> System-Prompt verbietet explizit die Nutzung von Wissen,
     das nicht im übergebenen JSON steht.
  -> Erzeugt nur: Kursentwicklung, Einflussfaktoren, Bull/Bear Case,
     Ausblick, Empfehlung (kurz/mittel/langfristig).
```

Dadurch sind die 5 Perspektiven-Abschnitte **nie** vom Modell frei
formuliert – nur die abschließende Synthese ist "Meinung", und die ist
klar als solche gekennzeichnet und auf die recherchierten Daten
beschränkt.

## Setup

1. `npm install`
2. `.env` aus `.env.example` erstellen:
   - `ANTHROPIC_API_KEY` – dein Anthropic API Key (console.anthropic.com)
   - `BIGDATA_AUTH_TOKEN` – Zugangsdaten für den Bigdata.com MCP-Server.
     **Wichtig:** Der Connector, den du in claude.ai verbunden hast,
     läuft über eine OAuth-Session dieses Chats. Für ein *externes*
     Skript brauchst du eigene Zugangsdaten direkt von Bigdata.com
     (deren Dashboard/Docs zeigen, ob das ein API-Key, Bearer-Token
     oder OAuth-Client ist). Das musst du einmalig bei Bigdata.com
     einrichten – das kann ich von hier aus nicht für dich auslesen.
3. `npm run start SAP` bzw. `node src/index.mjs "SAP"` (Ticker oder
   Firmenname als Argument)

## Status (verifiziert von Claude Code)

Die MCP-Tool-Namen/Parameter (`find_securities`, `bigdata_company_tearsheet`,
`bigdata_sentiment_tearsheet`, `bigdata_search`) wurden live gegen den echten
Bigdata.com-MCP-Server geprüft (z.B. `find_securities("SAP")` →
`rp_entity_id "FF8514"`, `listing_type PUBLIC`) und stimmen mit dem Skript
überein. Gegen die aktuelle Anthropic-Doku zum MCP-Connector abgeglichen und
folgende Abweichungen korrigiert:
- `tools: [{type: "mcp_toolset", mcp_server_name: "bigdata"}]` ergänzt
  (fehlte – ohne das lehnt die API den Request mit 400 ab)
- `anthropic.messages.create` → `anthropic.beta.messages.create` +
  `betas: ["mcp-client-2025-11-20"]` (der Connector ist Beta-only; der
  alte Header `mcp-client-2025-04-04` ist deprecated)
- Modellname `claude-sonnet-4-6` (existiert nicht) → `claude-sonnet-5`
- `@anthropic-ai/sdk` auf `^0.117.1` angehoben (die alte Version kennt
  `beta.messages.create` mit MCP-Feldern noch nicht)
- `src/`-Layout korrigiert, damit `package.json` (`main`/`start`) die
  Dateien tatsächlich findet
- `is_error` aus `mcp_tool_result`-Blöcken wird jetzt ausgewertet, damit
  fehlgeschlagene Tool-Calls nicht als Rechercheergebnis durchgereicht werden

`npm run start SAP` läuft strukturell durch (Argument-Parsing, MCP-Setup,
Request erreicht die echte Anthropic-API) und bricht ohne echte
`ANTHROPIC_API_KEY`/`BIGDATA_AUTH_TOKEN` sauber mit einem
`401 authentication_error` ab – kein Code-Crash mehr. Ein vollständiger
End-to-End-Lauf mit echten Ergebnissen erfordert deine eigenen Zugangsdaten
in `.env`.

## Offene nächste Schritte

- Fehlerbehandlung robuster machen (Rate Limits, leere Suchergebnisse)
- `report-template.mjs` auf dein gewünschtes Ausgabeformat (Markdown,
  HTML, PDF via docx/pdf-Skill) erweitern
- ggf. Websuche als Fallback ergänzen, wenn Bigdata.com zu einer
  Kategorie nichts liefert (Bigdata.com deckt via `bigdata_search`
  Smart-Mode bereits auch das offene Web ab)
