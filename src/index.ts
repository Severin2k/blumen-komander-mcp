#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import express from "express";

import { searchFlowersSchema, searchFlowers } from "./tools/search-flowers.js";
import {
  checkAvailabilitySchema,
  checkAvailability,
} from "./tools/check-availability.js";
import { createCartSchema, createCart } from "./tools/create-cart.js";
import {
  getCheckoutLinkSchema,
  getCheckoutLink,
} from "./tools/get-checkout-link.js";
import { getShopInfoSchema, getShopInfo } from "./tools/get-shop-info.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "blumen-komander",
    version: "1.0.0",
  });

  server.tool(
    "search_flowers",
    "Sucht verfügbare Blumensträuße bei Blumen Komander München. Filtert nach Anlass, Farbe, Stil und Budget.",
    searchFlowersSchema,
    searchFlowers
  );

  server.tool(
    "check_availability",
    "Prüft ob Blumen Komander München an einem bestimmten Datum in eine bestimmte PLZ liefern kann. Lieferung ist bei Blumen Komander immer kostenlos - keine Liefergebühr. Gibt Same-Day Cutoff zurück.",
    checkAvailabilitySchema,
    checkAvailability
  );

  server.tool(
    "create_cart",
    "Legt einen Warenkorb bei Blumen Komander an und fügt einen Blumenstrauß hinzu. Setzt Lieferdatum, Lieferadresse, Zahlungsmethode und optional eine Grußkarte. Fragt den Kunden ob die Rechnungsadresse von der Lieferadresse abweicht. Falls ja, werden billing_first_name, billing_last_name, billing_address_1, billing_postal_code und billing_city gesetzt. Falls nein, wird die Lieferadresse als Rechnungsadresse verwendet. Bevor der Warenkorb angelegt wird sollte die KI den Kunden fragen: 1. Weicht die Rechnungsadresse von der Lieferadresse ab? 2. Welche Zahlungsmethode bevorzugst du? - Kreditkarte / Apple Pay / Google Pay (stripe) - PayPal (paypal) - SEPA-Lastschrift (sepa)",
    createCartSchema,
    createCart
  );

  server.tool(
    "get_checkout_link",
    "Gibt den direkten Checkout-Link für einen bestehenden Warenkorb zurück. Der Kunde klickt auf den Link und zahlt.",
    getCheckoutLinkSchema,
    getCheckoutLink
  );

  server.tool(
    "get_shop_info",
    "Gibt allgemeine Informationen über Blumen Komander zurück - Öffnungszeiten, Liefergebiet, Kontakt, verfügbare Zahlungsmethoden.",
    getShopInfoSchema,
    getShopInfo
  );

  return server;
}

async function startStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  const port = parseInt(process.env.PORT || "3100", 10);
  const app = express();

  // --- Legacy SSE Transport (for Claude Desktop, etc.) ---
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (req, res) => {
    const server = createServer();
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, transport);

    transport.onclose = () => {
      sseTransports.delete(transport.sessionId);
    };

    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseTransports.get(sessionId);

    if (!transport) {
      res.status(400).json({
        error: true,
        message: "Invalid or expired session. Connect to /sse first.",
        type: "invalid_session",
      });
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  // --- Streamable HTTP Transport (for Mistral Le Chat, etc.) ---
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

  // Read raw body as Buffer so the stream is consumed exactly once
  app.use("/mcp", express.raw({ type: "*/*" }));

  app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Parse body once from the raw Buffer
    let parsedBody: unknown = undefined;
    if (req.method === "POST" && req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
      try {
        parsedBody = JSON.parse(req.body.toString());
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    if (req.method === "GET" || req.method === "POST") {
      // Check for existing session
      let transport = sessionId
        ? streamableTransports.get(sessionId)
        : undefined;

      if (!transport) {
        // Create new transport and server for this session
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            streamableTransports.set(id, transport!);
          },
        });

        transport.onclose = () => {
          if (transport!.sessionId) {
            streamableTransports.delete(transport!.sessionId);
          }
        };

        const server = createServer();
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, parsedBody);
    } else if (req.method === "DELETE") {
      if (sessionId && streamableTransports.has(sessionId)) {
        const transport = streamableTransports.get(sessionId)!;
        await transport.handleRequest(req, res, parsedBody);
        streamableTransports.delete(sessionId);
      } else {
        res.status(404).json({ error: "Session not found" });
      }
    } else {
      res.status(405).json({ error: "Method not allowed" });
    }
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "blumen-komander-mcp",
      version: "1.0.0",
      activeSessions: sseTransports.size + streamableTransports.size,
    });
  });

  // Glama-Verzeichnis: Besitz-Nachweis für den Connector-Claim
  // (https://glama.ai/mcp/connectors/io.github.Severin2k/blumen-komander-mcp)
  app.get("/.well-known/glama.json", (_req, res) => {
    res.json({
      $schema: "https://glama.ai/mcp/schemas/connector.json",
      maintainers: [{ email: "info@blumen-komander.de" }],
    });
  });

  app.listen(port, () => {
    console.log(`Blumen Komander MCP Server läuft auf Port ${port}`);
    console.log(`SSE Endpoint: http://localhost:${port}/sse`);
    console.log(`Streamable HTTP: http://localhost:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT || "stdio";

if (transport === "http") {
  startHttp().catch(console.error);
} else {
  startStdio().catch(console.error);
}
