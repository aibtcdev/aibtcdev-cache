import { Hono } from "hono";
import { CloudflareBindings } from "../worker-configuration";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
