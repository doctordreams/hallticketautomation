import { createApp } from '../server.ts';

const appPromise = createApp({ serveFrontend: false });

export default async function handler(req: any, res: any) {
  const app = await appPromise;
  return app(req, res);
}
