#!/usr/bin/env node
/** Ponto de entrada: `conector <comando>`. O aviso experimental do node:sqlite é tratado em util/sqlite.ts. */
import { executarCli } from './comandos';

function lerStdin(): Promise<string> {
  return new Promise((resolve) => {
    let t = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (t += d));
    process.stdin.on('end', () => resolve(t));
  });
}

const codigo = await executarCli(process.argv.slice(2), {
  saida: (t) => console.log(t),
  erro: (t) => console.error(t),
  lerEntrada: lerStdin,
  env: process.env,
});
process.exit(codigo);
