import { Hono } from "hono";
import { CloudflareBindings } from "../worker-configuration";
import { HiroApiDO } from "./durable-objects/hiro-api";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/api/v1/extended", async (c) => {
  try {
    const id = c.env.HIRO_API.idFromName("hiro-api");
    const hiroApiDO = c.env.HIRO_API.get(id);
    const response = await hiroApiDO.fetch(c.req.url);
    return new Response(response.body, response);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : `Unknown error ${String(error)}`,
        status: 500,
      },
      500
    );
  }
});

app.get("/api/v2/info", async (c) => {
  try {
    const id = c.env.HIRO_API.idFromName("hiro-api");
    const hiroApiDO = c.env.HIRO_API.get(id);
    const response = await hiroApiDO.fetch(c.req.url);
    return new Response(response.body, response);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : `Unknown error ${String(error)}`,
        status: 500,
      },
      500
    );
  }
});

// https://api.hiro.so/extended/v1/address/{principal}/assets
app.get("/api/v1/extended/address/:principal/assets", async (c) => {
  try {
    const id = c.env.HIRO_API.idFromName("hiro-api");
    const hiroApiDO = c.env.HIRO_API.get(id);
    const response = await hiroApiDO.fetch(c.req.url);
    return new Response(response.body, response);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : `Unknown error ${String(error)}`,
        status: 500,
      },
      500
    );
  }
});

export default app;

export { HiroApiDO };
