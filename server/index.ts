import { makeApp } from './app';
const service = makeApp();
const port = Number(process.env.PORT || 3002);
const server = service.app.listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(`Replay Studio API listening on ${port}`),
);
async function stop() {
  server.close();
  await service.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
