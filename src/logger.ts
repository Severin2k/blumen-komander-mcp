import { appendFile, mkdir } from "fs/promises";
import { join } from "path";

// Logging nur auf dem eigenen HTTP-Server (PM2), nicht bei stdio-Nutzern,
// die das npm-Paket lokal via npx laufen lassen.
const ENABLED =
  process.env.TRANSPORT === "http" || process.env.MCP_LOG === "1";

const LOG_DIR = process.env.MCP_LOG_DIR || join(process.cwd(), "logs");

let dirReady = false;

async function writeLine(entry: Record<string, unknown>) {
  if (!ENABLED) return;
  try {
    if (!dirReady) {
      await mkdir(LOG_DIR, { recursive: true });
      dirReady = true;
    }
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const file = join(LOG_DIR, `tool-calls-${month}.jsonl`);
    await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Logging darf nie einen Tool-Call zum Scheitern bringen
    console.error("logger:", (err as Error).message);
  }
}

// Personenbezogene Daten aus den Args entfernen, bevor sie ins Log gehen.
// Die vollständigen Bestelldaten landen ohnehin in Medusa - das Log dient
// nur der Nutzungsanalyse.
function sanitizeArgs(
  tool: string,
  args: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!args) return undefined;

  if (tool === "create_cart") {
    return {
      variant_id: args.variant_id,
      quantity: args.quantity,
      delivery_date: args.delivery_date,
      postal_code: args.postal_code,
      city: args.city,
      payment_provider: args.payment_provider,
      has_greeting_card: Boolean(args.greeting_card),
      billing_differs: Boolean(args.billing_first_name),
    };
  }
  if (tool === "get_order_status") {
    return { order_number: args.order_number };
  }
  return args;
}

export function logSessionStart(
  transport: "sse" | "streamable-http",
  sessionId: string,
  userAgent?: string
) {
  void writeLine({
    ts: new Date().toISOString(),
    event: "session_start",
    transport,
    session: sessionId,
    user_agent: userAgent || null,
  });
}

type ToolHandler<A> = (args: A, extra?: unknown) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

export function withLogging<A extends Record<string, unknown>>(
  tool: string,
  handler: ToolHandler<A>
): ToolHandler<A> {
  return async (args: A, extra?: unknown) => {
    const start = Date.now();
    const session =
      (extra as { sessionId?: string } | undefined)?.sessionId || null;
    try {
      const result = await handler(args, extra);
      void writeLine({
        ts: new Date().toISOString(),
        event: "tool_call",
        tool,
        session,
        args: sanitizeArgs(tool, args),
        ok: !result.isError,
        duration_ms: Date.now() - start,
      });
      return result;
    } catch (err) {
      void writeLine({
        ts: new Date().toISOString(),
        event: "tool_call",
        tool,
        session,
        args: sanitizeArgs(tool, args),
        ok: false,
        error: (err as Error).message,
        duration_ms: Date.now() - start,
      });
      throw err;
    }
  };
}
