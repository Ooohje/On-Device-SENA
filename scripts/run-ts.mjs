// scripts/*.ts를 esbuild로 번들해 Node에서 실행한다. 사용: node scripts/run-ts.mjs scripts/chat-sim.ts [args]
import { build } from 'esbuild';
import { spawnSync } from 'child_process';
import path from 'path';

const [entry, ...args] = process.argv.slice(2);
const outfile = path.join('scripts/.out', path.basename(entry).replace(/\.ts$/, '.cjs'));
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  alias: { 'onnxruntime-react-native': 'onnxruntime-node' },
  external: ['onnxruntime-node'],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, [outfile, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
