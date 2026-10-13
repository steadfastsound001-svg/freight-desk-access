import { handleRequest } from "./main.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const ORIGIN = "https://freight.example";
const UPSTREAM = "https://freight-desk-johnny.netlify.app";

Deno.test("streams assets larger than 16 KB unchanged and preserves safe headers", async () => {
  const bytes = Uint8Array.from({ length: 65537 }, (_, i) => i % 256);
  const fetchUpstream: typeof fetch = (input, init) => {
    assert(String(input) === UPSTREAM + "/assets/app.js?v=1");
    assert(init?.redirect === "manual");
    const headers = new Headers(init?.headers);
    for (const name of ["host", "cookie", "connection", "x-hop"]) assert(!headers.has(name));
    return Promise.resolve(new Response(bytes, { headers: {
      "Content-Type": "application/javascript",
      "Content-Encoding": "gzip",
      "Content-Length": "123",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'self'",
      "Connection": "x-response-hop",
      "X-Response-Hop": "remove",
    } }));
  };
  const response = await handleRequest(new Request(ORIGIN + "/assets/app.js?v=1", { headers: {
    host: "forged.example", cookie: "private=secret", connection: "x-hop", "x-hop": "remove",
  } }), fetchUpstream);
  assert(response.status === 200);
  for (const name of ["content-encoding", "content-length", "connection", "x-response-hop"]) assert(!response.headers.has(name));
  assert(response.headers.get("cache-control") === "public, max-age=3600");
  assert(response.headers.get("content-security-policy") === "default-src 'self'");
  const result = new Uint8Array(await response.arrayBuffer());
  assert(result.length === bytes.length && result.every((value, i) => value === bytes[i]));
});

Deno.test("valid API POST keeps body and rewrites Origin only after validating it", async () => {
  const body = JSON.stringify({ dataset: "demo", filters: {} });
  const fetchUpstream: typeof fetch = async (input, init) => {
    assert(String(input) === UPSTREAM + "/api/orders/search");
    assert(init?.method === "POST");
    const headers = new Headers(init.headers);
    assert(headers.get("origin") === UPSTREAM);
    assert(headers.get("x-freight-desk") === "1");
    assert(await new Response(init.body).text() === body);
    return Response.json({ rows: [] });
  };
  const response = await handleRequest(new Request(ORIGIN + "/api/orders/search", {
    method: "POST", body,
    headers: { origin: ORIGIN, "x-freight-desk": "1", "content-type": "application/json" },
  }), fetchUpstream);
  assert(response.status === 200);
  assert((await response.json()).rows.length === 0);
});

Deno.test("foreign or missing Origin and missing client marker never reach upstream", async () => {
  const fetchUpstream: typeof fetch = () => { throw new Error("must not forward"); };
  const cases: HeadersInit[] = [
    { origin: "https://foreign.example", "x-freight-desk": "1" },
    { "x-freight-desk": "1" },
    { origin: ORIGIN },
  ];
  for (const headers of cases) {
    const response = await handleRequest(new Request(ORIGIN + "/api/saved", { method: "POST", headers }), fetchUpstream);
    assert(response.status === 403);
  }
});

Deno.test("Render TLS termination accepts only the public HTTPS origin and rewrites redirects to HTTPS", async () => {
  const publicOrigin = "https://freight-desk-johnny.onrender.com";
  const internalUrl = "http://freight-desk-johnny.onrender.com/api/orders/search";
  let forwarded = 0;
  const fetchUpstream: typeof fetch = (_input, init) => {
    forwarded++;
    assert(new Headers(init?.headers).get("origin") === UPSTREAM);
    return Promise.resolve(new Response(null, { status: 302, headers: { location: UPSTREAM + "/orders" } }));
  };
  const request = (origin: string, protocol = "https") => new Request(internalUrl, {
    method: "POST",
    headers: { origin, "x-forwarded-proto": protocol, "x-freight-desk": "1" },
  });
  const accepted = await handleRequest(request(publicOrigin), fetchUpstream);
  assert(accepted.status === 302);
  assert(accepted.headers.get("location") === publicOrigin + "/orders");
  for (const rejected of [
    request("https://foreign.example"),
    request("http://freight-desk-johnny.onrender.com"),
    request(publicOrigin, "https, http"),
  ]) assert((await handleRequest(rejected, fetchUpstream)).status === 403);
  assert(forwarded === 1);
});

Deno.test("direct local HTTP keeps its origin and redirect scheme without forwarded headers", async () => {
  const localOrigin = "http://localhost:8000";
  const fetchUpstream: typeof fetch = () => Promise.resolve(new Response(null, {
    status: 302, headers: { location: UPSTREAM + "/orders" },
  }));
  const response = await handleRequest(new Request(localOrigin + "/api/saved", {
    method: "POST", headers: { origin: localOrigin, "x-freight-desk": "1" },
  }), fetchUpstream);
  assert(response.status === 302);
  assert(response.headers.get("location") === localOrigin + "/orders");
});

Deno.test("fixed upstream cannot be replaced through the path and redirects remain same-origin", async () => {
  const fetchUpstream: typeof fetch = (input) => {
    assert(new URL(String(input)).origin === UPSTREAM);
    return Promise.resolve(new Response(null, { status: 302, headers: { location: UPSTREAM + "/orders?next=1" } }));
  };
  const response = await handleRequest(new Request(ORIGIN + "//foreign.example/path"), fetchUpstream);
  assert(response.status === 302);
  assert(response.headers.get("location") === ORIGIN + "/orders?next=1");
});

Deno.test("upstream 502 and network errors become 503 without upstream details", async () => {
  const upstreams: (typeof fetch)[] = [
    () => Promise.resolve(new Response("private-backend-secret", { status: 502 })),
    () => Promise.reject(new Error("private-network-secret")),
  ];
  for (const fetchUpstream of upstreams) {
    const response = await handleRequest(new Request(ORIGIN + "/api/meta"), fetchUpstream);
    assert(response.status === 503);
    assert(response.headers.get("cache-control") === "no-store");
    const body = await response.text();
    assert(body.includes("Сервис временно недоступен"));
    assert(!body.includes("secret"));
  }
});
