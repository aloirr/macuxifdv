/** Texto do aviso de pulo dos testes de banco (T-0002 item 4). Não precisa de Postgres. */
import { describe, expect, it } from 'vitest';
import { textoAviso } from './aviso-pulos';

describe('aviso de testes de banco pulados', () => {
  it('Docker parado: mensagem curta com a contagem e o detalhe em seguida', () => {
    const t = textoAviso('Docker não está rodando (error during connect: pipe não encontrado)', 33);
    expect(t).toContain('[db] Docker não está rodando: 33 testes de banco pulados.');
    expect(t).toContain('[db] Detalhe: Docker não está rodando (error during connect');
    expect(t).toContain('MACUXI_PG_EXIGIR=1');
  });

  it('outro motivo aparece por inteiro; singular para 1 teste', () => {
    const t = textoAviso('Postgres indisponível em db:5432 (ECONNREFUSED)', 1);
    expect(t).toContain('[db] Postgres indisponível em db:5432 (ECONNREFUSED): 1 teste de banco pulado.');
    expect(t).not.toContain('Detalhe:');
  });
});
