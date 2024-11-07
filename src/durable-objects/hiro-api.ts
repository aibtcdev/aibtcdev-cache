export class HiroApiDO {
  private state: DurableObjectState;
  private env: CloudflareBindings;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly CACHE_TTL = 60 * 1000; // 1 minute cache TTL

  constructor(state: DurableObjectState, env: CloudflareBindings) {
    this.state = state;
    this.env = env;
    this.cache = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case '/api/v1/info':
          return await this.getBlockchainInfo();
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('Error in HiroApiDO:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async getBlockchainInfo(): Promise<Response> {
    const cacheKey = 'blockchain_info';
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return new Response(JSON.stringify(cached.data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch('https://api.hiro.so/v1/info', {
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.env.HIRO_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Hiro API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
