export const onRequest = async () => {
  // const value = await context.env.AIBTCDEV_CACHE_KV.get("example");
  return new Response("hiro-api/extended/v1/address/{principal}/assets");
};
