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
    apiPath: string = endpoint
  ): Promise<Response> {
    // Try to get from KV first
    const cached = await this.env.AIBTCDEV_CACHE_KV.get(cacheKey);
    if (cached) {
      return new Response(cached);
    }

    // If not in KV, fetch from Hiro API
    const response = await fetch(`${this.BASE_URL}${apiPath}`, {
      headers: {
        "x-hiro-api-key": this.env.HIRO_API_KEY,
      },
    });

    const data = await response.text();

    // Cache the response
    await this.env.AIBTCDEV_CACHE_KV.put(cacheKey, data, {
      expirationTtl: this.CACHE_TTL,
    });

    return new Response(data);
  }

  private async handleApiStatus(): Promise<Response> {
    return this.fetchWithCache(
      "/api/status",
      "hiro_api_status",
      "/extended"
    );
  }

  private async handleBlockchainInfo(): Promise<Response> {
    return this.fetchWithCache(
      "/v2/info",
      "hiro_blockchain_info"
    );
  }

  private async handleAccountAssets(path: string): Promise<Response> {
    const principal = path.split("/")[4];
    return this.fetchWithCache(
      path,
      `hiro_account_assets_${principal}`
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/status") {
      return this.handleApiStatus();
    }

    if (path === "/v2/info") {
      return this.handleBlockchainInfo();
    }

    if (path.startsWith("/extended/v1/address/") && path.endsWith("/assets")) {
      return this.handleAccountAssets(path);
    }

    return new Response("Not found", { status: 404 });
  }
}
