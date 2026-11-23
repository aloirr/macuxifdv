import { Writable } from 'node:stream';

/** Coletor de log em memória para o pino: guarda cada linha não vazia; `json()` devolve as linhas já interpretadas. */
export function coletor() {
  const linhas: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split('\n')) if (l.trim()) linhas.push(l);
      cb();
    },
  });
  return { linhas, stream, json: () => linhas.map((l) => JSON.parse(l) as Record<string, unknown>) };
}
