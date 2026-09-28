import http from "node:http";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 27.2: the real technical risk this sub-phase called out -- does a published dashboard
 * event actually reach an open `@Sse()` connection as a genuine, incrementally-delivered
 * HTTP chunk (not just "the code compiles")? This opens a real TCP connection to the test
 * app (not supertest's buffered `.expect()`, which waits for the response to CLOSE -- an SSE
 * stream never does) and reads it as data arrives, the same thing a browser's EventSource
 * does. Deliberately does not touch the BFF proxy (apps/shop-web) -- that's a separate,
 * already-covered unit concern (authenticated-proxy.test.ts's own streaming-passthrough
 * case) once this proves the backend half genuinely streams. */
describe("Dashboard live (§SSE, 27.2, e2e)", () => {
  let fx: Fx;
  let port: number;

  beforeAll(async () => {
    fx = await createPhase19Fixture("dashboard-live", {
      multiItemEnabled: false,
      documentPages: 2,
    });
    await new Promise<void>((resolve) => {
      fx.app.getHttpServer().listen(0, "127.0.0.1", resolve);
    });
    port = (fx.app.getHttpServer().address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => fx.app.getHttpServer().close(() => resolve()));
    await fx?.cleanup();
  });

  function openStream(
    shopId: string,
    token: string,
  ): {
    chunks: Promise<string[]>;
    close: () => void;
  } {
    const chunks: string[] = [];
    let resolveChunks: (value: string[]) => void;
    const chunksPromise = new Promise<string[]>((resolve) => {
      resolveChunks = resolve;
    });
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: `/v1/shop/dashboard/live?shopId=${shopId}`,
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          chunks.push(chunk);
          if (chunk.includes('"kind"')) resolveChunks([...chunks]);
        });
      },
    );
    req.on("error", () => resolveChunks([]));
    // Never let a genuinely silent stream hang the test forever.
    const timeout = setTimeout(() => resolveChunks([...chunks]), 8_000);
    void chunksPromise.then(() => clearTimeout(timeout));
    return { chunks: chunksPromise, close: () => req.destroy() };
  }

  it("a published order event reaches an open SSE connection as a real, incrementally-delivered chunk", async () => {
    const stream = openStream(fx.shop.id, fx.token);
    // Give the connection a moment to actually establish before producing the event --
    // otherwise a fast publish could race the subscription itself.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await fx.makePrinter("dashboard-live-printer");
    const { orderId } = await fx.makeOrder(1);
    const acceptRes = await request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${fx.token}`);
    expect(acceptRes.status).toBe(200);

    const chunks = await stream.chunks;
    stream.close();
    const joined = chunks.join("");
    expect(joined).toContain("data:");
    expect(joined).toContain('"kind":"order"');
  });

  it("an event for a DIFFERENT shop never reaches this connection", async () => {
    const other = await createPhase19Fixture("dashboard-live-other", { multiItemEnabled: false });
    try {
      const stream = openStream(fx.shop.id, fx.token);
      await new Promise((resolve) => setTimeout(resolve, 200));

      await other.makePrinter("other-shop-printer");
      const { orderId } = await other.makeOrder(1);
      await request(fx.app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set("Authorization", `Bearer ${other.token}`);

      // Nothing to wait ON here except the timeout itself: a correct filter produces silence.
      const chunks = await stream.chunks;
      stream.close();
      expect(chunks.join("")).not.toContain('"kind"');
    } finally {
      await other.cleanup();
    }
  }, 15_000);

  it("staff from a different shop cannot open this shop's live stream (403)", async () => {
    const other = await createPhase19Fixture("dashboard-live-forbidden", {
      multiItemEnabled: false,
    });
    try {
      const res = await request(fx.app.getHttpServer())
        .get(`/v1/shop/dashboard/live?shopId=${fx.shop.id}`)
        .set("Authorization", `Bearer ${other.token}`);
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });
});
