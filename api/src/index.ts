import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { migrate } from './migrate.ts';

await migrate();

const server = createServer(createApp());
server.listen(config.port, () => console.log(`API ouvindo em http://localhost:${config.port}`));
