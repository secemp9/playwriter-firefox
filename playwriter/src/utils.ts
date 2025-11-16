export function getCdpUrl({ port = 19988, host = '127.0.0.1', clientId }: { port?: number; host?: string; clientId?: string } = {}) {
  const id = clientId || Date.now().toString()
  return `ws://${host}:${port}/cdp/${id}`
}
