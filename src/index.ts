import { Hono } from "hono";
import { CloudflareBindings } from "../worker-configuration";
import { HiroApiDO } from "./durable-objects/hiro-api";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/api/v1/info", async (c) => {
  const id = c.env.HIRO_API.idFromName("hiro-api");
  const hiroApiDO = c.env.HIRO_API.get(id);
  const response = await hiroApiDO.fetch(c.req.url);
  return response;
});

export default app;

export { HiroApiDO };
