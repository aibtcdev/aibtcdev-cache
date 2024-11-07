import { DurableObject } from "cloudflare:workers";
import { CloudflareBindings } from "../../worker-configuration";
import { ApiEndpoint } from "../interfaces/hiro-api";
import { BlockchainInfoEndpoint } from "../endpoints/blockchain-info";
import { ExtendedInfoEndpoint } from "../endpoints/extended-info";

export class HiroApiDO extends DurableObject<CloudflareBindings> {
  private endpoints: Map<string, ApiEndpoint>;
  private readonly UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.endpoints = new Map();

    // Register endpoints
    const endpoints: ApiEndpoint[] = [
      new BlockchainInfoEndpoint(env),
      new ExtendedInfoEndpoint(env),
    ];

    endpoints.forEach((endpoint) => {
      this.endpoints.set(endpoint.path, endpoint);
    });

    // Setup background updates
    this.ctx.blockConcurrencyWhile(async () => {
      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm) {
        await this.scheduleNextUpdate();
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.toString());
    const endpoint = this.endpoints.get(url.pathname);

    if (!endpoint) {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const data = await endpoint.fetch();
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error in HiroApiDO:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  async alarm(): Promise<void> {
    // Update all endpoints
    await Promise.all(
      Array.from(this.endpoints.values()).map((endpoint) => endpoint.update())
    );
    await this.scheduleNextUpdate();
  }

  private async scheduleNextUpdate(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + this.UPDATE_INTERVAL);
  }
}
