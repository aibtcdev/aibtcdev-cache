export const onRequest: PagesFunction<CloudflareBindings> = async (context) => {
  const id = context.env.HIRO_API.idFromName("hiro-api");
  const hiroApi = context.env.HIRO_API.get(id);
  
  return hiroApi.fetch(context.request);
};
