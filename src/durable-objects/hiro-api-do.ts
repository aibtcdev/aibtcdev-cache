import { CloudflareBindings } from "../../worker-configuration";

export class HiroApiDO {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly BASE_URL = "https://api.hiro.so";

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareBindings
  ) {}

  private async fetchWithCache(
    endpoint: string,
    cacheKey: string,
    cacheTtl: number = this.CACHE_TTL
  ): Promise<Response> {
    // try to get from KV, return if found
    const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);
    if (cached) {
      return new Response(cached);
    }

    // if not in KV, fetch from API
    const url = new URL(endpoint, this.BASE_URL);
    const response = await fetch(url, {
      headers: {
        "x-hiro-api-key": this.env.HIRO_API_KEY,
      },
    });

    if (!response.ok) {
      return new Response(
        `Error fetching data from Hiro API: ${response.statusText}, ${url}`,
        { status: response.status }
      );
    }

    const data = await response.text();

    // Cache the response
    await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, data, {
      expirationTtl: cacheTtl,
    });

    return new Response(data);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/extended") {
      return this.fetchWithCache("/extended", "hiro_api_extended");
    }

    if (path === "/v2/info") {
      return this.fetchWithCache("/v2/info", "hiro_api_v2_info");
    }

    if (path.startsWith("/extended/v1/address/")) {
      const principal = path.split("/")[4];
      if (path.endsWith("/assets")) {
        return this.fetchWithCache(
          path,
          `hiro_api_extended_v1_address_${principal}_assets`
        );
      }
      if (path.endsWith("/balances")) {
        return this.fetchWithCache(
          path,
          `hiro_api_extended_v1_address_${principal}_balances`
        );
      }
    }

    if (path === "/extended/v1/tx") {
      return this.fetchWithCache(path, "hiro_api_extended_v1_tx");
    }

    if (path === "/extended/v1/tx/mempool") {
      return this.fetchWithCache(path, "hiro_api_extended_v1_tx_mempool");
    }

    return new Response("Not found", { status: 404 });
  }
}
