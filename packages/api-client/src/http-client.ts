import { ApiClientError } from "./errors/api-client-error.js";
import type { AuthStrategy } from "./auth/auth-strategy.js";

export interface HttpClientOptions {
  baseUrl: string;
  authStrategy: AuthStrategy;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** `false` for the auth endpoints that establish a session in the
   * first place (register/login/refresh/logout/recovery): they must not
   * carry a stale credential, and a 401 from them means "bad input", not
   * "session needs refreshing", so the retry-on-401 loop below must not
   * run for them. Defaults to `true`. */
  authenticated?: boolean;
}

/** The one piece of fetch logic this whole project has, shared by every
 * client (§3.1's Done-when). Auth attachment and refresh-on-401 are
 * delegated to the `AuthStrategy` supplied at construction; everything
 * else here is identical regardless of which one that is. */
export class HttpClient {
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private readonly options: HttpClientOptions) {}

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const response = await this.sendWithRefresh(path, opts);
    return parseJsonResponse<T>(response);
  }

  /** For endpoints that return raw bytes rather than JSON -- currently
   * only document download (§65: streamed through one authenticated
   * call, never a link). */
  async requestBlob(path: string, opts: RequestOptions = {}): Promise<Blob> {
    const response = await this.sendWithRefresh(path, opts);
    if (!response.ok) {
      throw ApiClientError.fromResponse(
        response.status,
        response.statusText,
        await parseBody(response),
      );
    }
    return response.blob();
  }

  private async sendWithRefresh(path: string, opts: RequestOptions): Promise<Response> {
    const response = await this.send(path, opts);
    if (response.status !== 401 || opts.authenticated === false) {
      return response;
    }

    // Concurrent requests that all 401 at once (a page that fires five
    // requests on mount, say) must trigger exactly one refresh call, not
    // a stampede (3.1's Done-when) -- every caller past this point
    // awaits the same in-flight promise instead of starting its own.
    const refreshed = await this.deduplicatedRefresh();
    return refreshed ? this.send(path, opts) : response;
  }

  private deduplicatedRefresh(): Promise<boolean> {
    this.refreshInFlight ??= this.options.authStrategy.refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async send(path: string, opts: RequestOptions): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = buildUrl(this.options.baseUrl, path, opts.query);
    const authInit = opts.authenticated === false ? {} : this.options.authStrategy.getRequestInit();
    const authHeaders =
      opts.authenticated === false ? {} : await this.options.authStrategy.getHeaders();

    return fetchImpl(url, {
      ...authInit,
      method: opts.method ?? "GET",
      // `authInit.headers` is spread first, not just discarded by the
      // explicit key below -- a strategy that contributes headers via
      // `getRequestInit()` (rather than `getHeaders()`) must not have
      // them silently dropped here.
      headers: {
        "Content-Type": "application/json",
        ...(authInit.headers as Record<string, string> | undefined),
        ...authHeaders,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    throw ApiClientError.fromResponse(response.status, response.statusText, payload);
  }
  return payload as T;
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return text.length > 0 ? text : undefined;
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions["query"]): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
