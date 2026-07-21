# Blumen Komander MCP Server

Deutschlands erster Florist mit öffentlichem MCP Server. Bestelle Blumen in München per KI-Assistent - von der Suche bis zum Checkout.

## Was dieser Server kann

- **Blumen suchen** - nach Anlass, Farbe, Budget und Stil filtern
- **Verfügbarkeit prüfen** - Lieferbarkeit für Datum und PLZ prüfen
- **Warenkorb anlegen** - mit Lieferadresse, Grußkarte und Zahlungsmethode
- **Checkout-Link** - Kunde klickt und zahlt selbst
- **Bestellstatus abfragen** - mit Bestellnummer und E-Mail

Lieferung ist immer kostenlos.
Nur München und Umland (PLZ 80xxx-81xxx).

## Remote Server (keine Installation nötig)

Direkt nutzbar ohne lokale Installation:

- SSE: `https://mcp.blumen-verschicken.online/sse`
- HTTP: `https://mcp.blumen-verschicken.online/mcp`

## Installation

### Claude Desktop

Füge folgendes in deine `claude_desktop_config.json` ein:

- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "blumen-komander": {
      "url": "https://mcp.blumen-verschicken.online/sse"
    }
  }
}
```

### Mistral Le Chat (kostenlos, im Browser)

Intelligence > Connectors > Add custom connector
- URL: `https://mcp.blumen-verschicken.online/mcp`
- Authentication: None

### ChatGPT (Plus/Pro erforderlich)

Settings > Connectors > Advanced Settings > Developer Mode aktivieren
- URL: `https://mcp.blumen-verschicken.online/mcp`

### Gemini CLI

```json
{
  "mcpServers": {
    "blumen-komander": {
      "httpUrl": "https://mcp.blumen-verschicken.online/mcp"
    }
  }
}
```

### Copilot Studio

Tools > Add a tool > Model Context Protocol
- URL: `https://mcp.blumen-verschicken.online/mcp`
- Authentication: None

## Verfügbare Tools

| Tool | Beschreibung |
|------|-------------|
| search_flowers | Blumensträuße nach Anlass, Farbe, Budget suchen |
| check_availability | Lieferverfügbarkeit für Datum und PLZ prüfen |
| create_cart | Warenkorb anlegen mit Adresse, Grußkarte, Zahlung |
| get_checkout_link | Checkout-Link für bestehenden Warenkorb abrufen |
| get_shop_info | Öffnungszeiten, Kontakt, Zahlungsmethoden |
| get_order_status | Bestellstatus abfragen (Bestellnummer + E-Mail, keine Adressdaten) |

## Typischer Bestellablauf

Nutzer: "Bestell Blumen zum Geburtstag, Rosa, max 60 Euro, Freitag nach München PLZ 80799"

KI führt aus:
1. `search_flowers(occasion=geburtstag, color=rosa, maxPrice=60)`
2. `check_availability(date=2026-05-22, postalCode=80799)`
3. `create_cart(variant_id=..., delivery_date=..., adresse=...)`
4. Checkout-Link an Nutzer - Nutzer zahlt selbst

## Sicherheit

- Keine autonome Zahlung - Checkout immer manuell
- Publishable API Key (read + cart only)
- Keine Kundendaten gespeichert

## Über Blumen Komander

Münchner Fachflorist seit 1965.
Heßstraße 37, 80798 München
https://blumen-komander.de

## API Dokumentation

https://blumen-verschicken.online/llms.txt

## Lizenz

MIT
