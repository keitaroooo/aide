interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ env, request }) =>
  env.API.fetch(request);
