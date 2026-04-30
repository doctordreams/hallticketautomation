export function getBody(req: any) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export function sendError(res: any, status: number, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return res.status(status).json({ error: message });
}
