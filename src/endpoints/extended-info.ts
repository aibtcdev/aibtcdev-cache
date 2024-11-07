import { CloudflareBindings } from "../../worker-configuration";
import { ApiEndpoint, ExtendedInfo } from "../interfaces/hiro-api";

export class ExtendedInfoEndpoint implements ApiEndpoint {
  readonly path = "/api/extended";
  private env: CloudflareBindings;
  private kvKey = "extended_info";

  constructor(env: CloudflareBindings) {
    this.env = env;
  }

  async fetch(): Promise<ExtendedInfo> {
    const cached = await this.env.AIBTCDEV_CACHE_KV.get(this.kvKey, "json");
    if (!cached) {
      // Fallback to direct API call if KV is empty
      return this.fetchFromApi();
    }
    return cached as ExtendedInfo;
  }

  async update(): Promise<void> {
    const data = await this.fetchFromApi();
    await this.env.AIBTCDEV_CACHE_KV.put(this.kvKey, JSON.stringify(data));
  }

  private async fetchFromApi(): Promise<ExtendedInfo> {
    const response = await fetch("https://api.hiro.so/extended", {
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
