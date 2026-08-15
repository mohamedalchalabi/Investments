/**
 * Extrahiert ausschliesslich die rohen Tool-Ergebnisse (mcp_tool_result)
 * aus einer Anthropic-API-Antwort. Text-Bloecke (freie Modell-Aeusserungen)
 * werden bewusst NICHT als "recherchierte Fakten" behandelt.
 */
export function extractToolResults(response) {
  const results = [];
  for (const block of response.content ?? []) {
    if (block.type === "mcp_tool_use") {
      results.push({ kind: "call", name: block.name, input: block.input });
    }
    if (block.type === "mcp_tool_result") {
      const text = block.content?.[0]?.text ?? "";
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null; // manche Bigdata-Antworten sind Markdown, kein JSON
      }
      results.push({
        kind: "result",
        tool_use_id: block.tool_use_id,
        is_error: block.is_error ?? false,
        raw_text: text,
        json: parsed,
      });
    }
  }
  return results;
}

/**
 * Modell-Textbloecke separat einsammeln - nur zur Diagnose/Logging,
 * NIEMALS als Faktenquelle fuer den Report verwenden.
 */
export function extractModelText(response) {
  return (response.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
