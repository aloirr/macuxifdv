/** Uma única instância por pasta de dados: dois Conectores gravando a mesma fila corromperiam o cursor. */
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function adquirirTrava(pasta: string): () => void {
  const arq = join(pasta, 'conector.lock');
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const fd = openSync(arq, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(arq, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(arq, 'utf8').trim());
      if (Number.isInteger(pid) && pid !== process.pid && vivo(pid)) {
        throw new Error(`Já existe um Conector rodando com esta pasta de dados (PID ${pid}). Pare-o antes de iniciar outro.`);
      }
      rmSync(arq, { force: true }); // sobra de uma execução que caiu
    }
  }
  throw new Error('Não foi possível obter a trava de instância única.');
}
