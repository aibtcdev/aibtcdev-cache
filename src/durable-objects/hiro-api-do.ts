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
      const response = await fetch("https://api.hiro.so/extended/v1/status", {
        headers: {
          'x-hiro-api-key': this.env.HIRO_API_KEY
        }
      });

      const data = await response.text();
      
      // Cache the response in KV for 5 minutes
      await this.env.AIBTCDEV_CACHE_KV.put("hiro_api_status", data, {
        expirationTtl: 300 // 5 minutes
      });

      return new Response(data);
    }

    return new Response("Not found", { status: 404 });
  }
}
