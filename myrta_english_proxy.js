const http = require("http");
const { URL } = require("url");

const TARGET_ORIGIN = "https://www.myrta.com";
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_ORIGIN = `http://127.0.0.1:${PORT}`;

function rewriteBody(text) {
  return text
    .replaceAll("https://www.myrta.com", PUBLIC_ORIGIN)
    .replaceAll("http://www.myrta.com", PUBLIC_ORIGIN)
    .replaceAll("//www.myrta.com", `//127.0.0.1:${PORT}`);
}

function rewriteSetCookie(value) {
  return value
    .replace(/;\s*Domain=[^;]*/gi, "")
    .replace(/;\s*Secure/gi, "")
    .replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
}

const server = http.createServer(async (req, res) => {
  try {
    const targetUrl = new URL(req.url, TARGET_ORIGIN);
    targetUrl.protocol = "https:";
    targetUrl.host = "www.myrta.com";

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      const lower = key.toLowerCase();
      if (["host", "origin", "referer", "accept-language", "content-length"].includes(lower)) {
        continue;
      }
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("host", "www.myrta.com");
    headers.set("accept-language", "en-US,en;q=0.9");
    headers.set(
      "user-agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    );
    if (req.headers.origin) headers.set("origin", TARGET_ORIGIN);
    if (req.headers.referer) headers.set("referer", String(req.headers.referer).replace(PUBLIC_ORIGIN, TARGET_ORIGIN));

    const method = req.method || "GET";
    const body = ["GET", "HEAD"].includes(method) ? undefined : req;
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: "manual",
      duplex: body ? "half" : undefined,
    });

    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(lower)) return;
      if (lower === "location") {
        responseHeaders[key] = value.replace(TARGET_ORIGIN, PUBLIC_ORIGIN).replace("http://www.myrta.com", PUBLIC_ORIGIN);
        return;
      }
      if (lower !== "set-cookie") responseHeaders[key] = value;
    });

    const rawSetCookie = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
    if (rawSetCookie.length) responseHeaders["set-cookie"] = rawSetCookie.map(rewriteSetCookie);

    const contentType = upstream.headers.get("content-type") || "";
    res.writeHead(upstream.status, responseHeaders);

    if (/text|javascript|json|xml|html|css/i.test(contentType)) {
      const text = await upstream.text();
      res.end(rewriteBody(text));
    } else {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.end(buffer);
    }
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(error && error.stack ? error.stack : error));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`myRTA English proxy listening at ${PUBLIC_ORIGIN}`);
});
