import { EventContext } from "@cloudflare/workers-types";
import { CloudflareBindings } from "../../../worker-configuration";

export const onRequest = async (
  context: EventContext<CloudflareBindings, any, any>
) => {
  return new Response("Hello from Hiro API v2!");
  const id = context.env.HIRO_API.idFromName("hiro-api");
  const hiroApi = context.env.HIRO_API.get(id);
  return hiroApi.fetch(context.request);
};
