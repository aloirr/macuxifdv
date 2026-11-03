/**
 * Relator do Vitest que avisa, no FIM da execução, quantos testes de banco pularam e por quê
 * (ex.: "Docker não está rodando: 33 testes de banco pulados"). O motivo vem do globalSetup, que roda
 * no mesmo processo e o deixa na variável abaixo. Com banco acessível não imprime nada.
 */
import type { Reporter, TestModule } from 'vitest/node';

export const VAR_MOTIVO_PULO = 'MACUXI_DB_MOTIVO_PULO';

export function textoAviso(motivo: string, pulados: number): string {
  const curto = motivo.startsWith('Docker não está rodando') ? 'Docker não está rodando' : motivo;
  const testes = pulados === 1 ? 'teste de banco pulado' : 'testes de banco pulados';
  return (
    `\n[db] ${curto}: ${pulados} ${testes}.` +
    (curto !== motivo ? `\n[db] Detalhe: ${motivo}` : '') +
    '\n[db] Para rodar: abra o Docker Desktop (os testes sobem o db/docker-compose.yml sozinhos) ou' +
    '\n[db] "pnpm --filter @macuxi/db banco subir-testes" (Postgres dos testes, 5434). No CI, MACUXI_PG_EXIGIR=1 transforma o pulo em falha.\n'
  );
}

export default class AvisoPulos implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const motivo = process.env[VAR_MOTIVO_PULO];
    if (!motivo) return;
    let pulados = 0;
    for (const m of testModules) {
      for (const t of m.children.allTests()) if (t.result().state === 'skipped') pulados++;
    }
    console.warn(textoAviso(motivo, pulados));
  }
}
