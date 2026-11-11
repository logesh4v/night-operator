// Bridge to LINE 13's own contract validator and graph solver. Read-only: we import its
// source (Node >= 22.18 strips types) and never write into that checkout.
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_LINE13_ROOT = '/Users/logesh/.kiro/crew/workspace/line-13';

export function line13Root() {
  return process.env.LINE13_ROOT ?? DEFAULT_LINE13_ROOT;
}

const cache = new Map();
export async function loadLine13(root = line13Root()) {
  if (cache.has(root)) return cache.get(root);
  const graphPath = path.join(root, 'packages/graph/src/index.ts');
  const contractsPath = path.join(root, 'packages/contracts/src/index.ts');
  if (!existsSync(graphPath) || !existsSync(contractsPath)) {
    throw new Error(`LINE 13 checkout not found at ${root}; set LINE13_ROOT to a checkout containing packages/graph and packages/contracts.`);
  }
  const [graph, contracts] = await Promise.all([
    import(pathToFileURL(graphPath).href),
    import(pathToFileURL(contractsPath).href),
  ]);
  const api = { root, graph, contracts };
  cache.set(root, api);
  return api;
}
