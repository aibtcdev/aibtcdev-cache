import { Hono } from "hono";
import { renderer } from "./renderer";
import { CloudflareBindings } from "../worker-configuration";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(renderer);

app.get("/", (c) => c.render(<h1>Welcome to the cache!</h1>));

export default app;
