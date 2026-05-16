const PUBLIC_URL = "https://blumen-verschicken.online";
const BACKEND_URL = "http://localhost:9000";
const API_KEY =
  "pk_56bc207f5f8247de00ee0ba88ce025eb61bac0e268aa1636bf3e8b11d8a25248";
const REGION_ID = "reg_01KMQTA6Q2M2MWBGVDRCY768WJ";

interface ApiOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}

interface MedusaError {
  message?: string;
  type?: string;
}

export class ApiError extends Error {
  public statusCode: number;
  public type: string;

  constructor(statusCode: number, message: string, type: string) {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
  }
}

export async function apiCall(
  path: string,
  options: ApiOptions = {}
): Promise<unknown> {
  const { method = "GET", body, params } = options;

  let url = `${BACKEND_URL}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        searchParams.set(key, value);
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-publishable-api-key": API_KEY,
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let errorData: MedusaError = {};
    try {
      errorData = JSON.parse(responseText) as MedusaError;
    } catch {
      errorData = { message: responseText || `HTTP ${response.status}`, type: "unknown_error" };
    }
    throw new ApiError(
      response.status,
      errorData.message || `HTTP ${response.status}`,
      errorData.type || "api_error"
    );
  }

  return response.json();
}

export { PUBLIC_URL, BACKEND_URL, REGION_ID };
