import { PagesFunction } from "@cloudflare/workers-types";
import { CloudflareBindings } from "../../../worker-configuration";

export const onRequest: PagesFunction<CloudflareBindings> = async (context) => {
  try {
    const id = context.env.HIRO_API.idFromName("hiro-api");
    if (!id) {
      throw new Error("Failed to generate Durable Object ID");
    }
    console.log("Durable Object ID:", id);

    const hiroApi = context.env.HIRO_API.get(id);
    console.log("Durable Object:", hiroApi);
    const response = await hiroApi.fetch(context.request);

    if (!response.ok) {
      throw new Error("Failed to fetch data from Hiro API");
    }

    return response; // Explicitly return the Response object
  } catch (error) {
    console.error("Error occurred:", error);
    // throw the error
    throw new Error("Internal Server Error");
  }
};
