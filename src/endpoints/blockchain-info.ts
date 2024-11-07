import { CloudflareBindings } from "../../worker-configuration";
import { ApiEndpoint, BlockchainInfo } from "../interfaces/hiro-api";

export class BlockchainInfoEndpoint implements ApiEndpoint {
  readonly path = "/api/v2/info";
  private env: CloudflareBindings;
  private kvKey = "blockchain_info";

  constructor(env: CloudflareBindings) {
    this.env = env;
  }

  async fetch(): Promise<BlockchainInfo> {
    const cached = await this.env.AIBTCDEV_CACHE_KV.get(this.kvKey, "json");
    if (!cached) {
      // Fallback to direct API call if KV is empty
      return this.fetchFromApi();
    }
    return cached as BlockchainInfo;
  }

  async update(): Promise<void> {
    const data = await this.fetchFromApi();
    await this.env.AIBTCDEV_CACHE_KV.put(this.kvKey, JSON.stringify(data));
  }

  private async fetchFromApi(): Promise<BlockchainInfo> {
    const response = await fetch("https://api.hiro.so/v2/info", {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.env.HIRO_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`Hiro API error: ${response.statusText}`);
    }

    return response.json();
  }
}
