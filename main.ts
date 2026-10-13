const UPSTREAM = "https://freight-desk-johnny.netlify.app";
const HOP_HEADERS = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
];

function forwardedHeaders(source: Headers) {
  const headers = new Headers(source);
  const connection = headers.get("connection")?.split(",") || [];
  for (const name of [...HOP_HEADERS, ...connection]) {
    if (name.trim()) headers.delete(name.trim());
  }
  return headers;
}

function error(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function handleRequest(request: Request, fetchUpstream: typeof fetch = fetch): Promise<Response> {
  const incoming = new URL(request.url);
  const readOnly = request.method === "GET" || request.method === "HEAD";
  if (!readOnly && (request.headers.get("origin") !== incoming.origin || request.headers.get("x-freight-desk") !== "1"))
    return error("Запрос с другого сайта отклонён.", 403);
  try {
    const target = new URL(UPSTREAM);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = forwardedHeaders(request.headers);
    headers.delete("host");
    headers.delete("cookie");
    if (headers.has("origin")) headers.set("origin", UPSTREAM);
    const response = await fetchUpstream(target, {
      method: request.method,
      headers,
      body: readOnly ? undefined : request.body,
      redirect: "manual",
      signal: request.signal,
    });
    if (response.status >= 500) {
      await response.body?.cancel();
      return error("Сервис временно недоступен. Повторите запрос позже.", 503);
    }
    const outgoing = forwardedHeaders(response.headers);
    // Fetch decodes compressed bodies, so the upstream encoding and length no longer apply.
    outgoing.delete("content-encoding");
    outgoing.delete("content-length");
    const location = outgoing.get("location");
    if (location) {
      const redirect = new URL(location, target);
      if (redirect.origin === UPSTREAM) {
        redirect.protocol = incoming.protocol;
        redirect.host = incoming.host;
        outgoing.set("location", redirect.href);
      }
    }
    return new Response(readOnly && request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outgoing,
    });
  } catch {
    return error("Сервис временно недоступен. Повторите запрос позже.", 503);
  }
}

if (import.meta.main) Deno.serve((request) => handleRequest(request));
