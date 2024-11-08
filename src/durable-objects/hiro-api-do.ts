import { CloudflareBindings } from "../../worker-configuration";

export class HiroApiDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareBindings
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/status") {
      // Try to get from KV first
      const cached = await this.env.AIBTCDEV_CACHE_KV.get("hiro_api_status");
      if (cached) {
        return new Response(cached);
      }

      // If not in KV, fetch from Hiro API
      const response = await fetch("https://api.hiro.so/extended", {
        headers: {
          "x-hiro-api-key": this.env.HIRO_API_KEY,
        },
      });

      const data = await response.text();

      // Cache the response in KV for 5 minutes
      await this.env.AIBTCDEV_CACHE_KV.put("hiro_api_status", data, {
        expirationTtl: 300, // 5 minutes
      });

      return new Response(data);
    }

    if (path === "/v2/info") {
      // Try to get from KV first
      const cached = await this.env.AIBTCDEV_CACHE_KV.get(
        "hiro_blockchain_info"
      );
      if (cached) {
        return new Response(cached);
      }

      // If not in KV, fetch from Hiro API
      const response = await fetch("https://api.hiro.so/v2/info", {
        headers: {
          "x-hiro-api-key": this.env.HIRO_API_KEY,
        },
      });

      const data = await response.text();

      // Cache the response in KV for 5 minutes
      await this.env.AIBTCDEV_CACHE_KV.put("hiro_blockchain_info", data, {
        expirationTtl: 300, // 5 minutes
      });

      return new Response(data);
    }

    if (path.startsWith("/extended/v1/address/") && path.endsWith("/assets")) {
      const principal = path.split("/")[4]; // Get the address from the path

      // Try to get from KV first with address-specific key
      const cacheKey = `hiro_account_assets_${principal}`;
      const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);
      if (cached) {
        return new Response(cached);
      }

      // If not in KV, fetch from Hiro API
      const response = await fetch(`https://api.hiro.so${path}`, {
        headers: {
          "x-hiro-api-key": this.env.HIRO_API_KEY,
        },
      });

      const data = await response.text();

      // Cache the response in KV for 5 minutes
      await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, data, {
        expirationTtl: 300, // 5 minutes
      });

      return new Response(data);
    }

    return new Response("Not found", { status: 404 });
  }
}
