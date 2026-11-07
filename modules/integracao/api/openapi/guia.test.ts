import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENTIDADES, ROTAS_HUB } from '../../contracts';
import { PARAMETROS_PADRAO } from '../../domain';
import { DEPENDENCIAS } from '../../domain/ordem';
import { LOTE_ID_EXEMPLO, PEDIDO_UUID_EXEMPLO } from './exemplos';
import { aplicarExemplosNoGuia, idsDoGuia, valorDoExemplo } from './guia';

const ARQUIVO_GUIA = fileURLToPath(new URL('../../docs/guia-api-hub.md', import.meta.url));
const guia = readFileSync(ARQUIVO_GUIA, 'utf8').replaceAll('\r\n', '\n');

describe('guia da API do Hub (docs/guia-api-hub.md)', () => {
  it('os blocos JSON do guia são exatamente os exemplos testados do OpenAPI (regerar: pnpm --filter @macuxi/integracao openapi)', () => {
    expect(idsDoGuia(guia).length).toBeGreaterThan(15);
    expect(aplicarExemplosNoGuia(guia), 'blocos de exemplo do guia desatualizados: rode "pnpm --filter @macuxi/integracao openapi"').toBe(guia);
  });

  it('exemplo inexistente ou tipo desconhecido lança erro', () => {
    expect(() => valorDoExemplo('lote:nao_existe')).toThrow(/não existe/);
    expect(() => valorDoExemplo('foo:bar')).toThrow(/desconhecido/);
    expect(() => aplicarExemplosNoGuia('<!-- exemplo:resultado:fantasma -->\n<!-- /exemplo -->')).toThrow(/não existe/);
  });

  it('os ids dos exemplos citados no curl batem com os exemplos (lote e pedido)', () => {
    expect(guia).toContain(`LOTE="${LOTE_ID_EXEMPLO}"`);
    expect(guia).toContain(`PEDIDO="${PEDIDO_UUID_EXEMPLO}"`);
  });

  it('cita as 7 rotas do contrato, todas as entidades, os cabeçalhos e o Retry-After', () => {
    for (const r of ROTAS_HUB) {
      expect(guia, `${r.metodo} ${r.caminho}`).toContain(r.caminho);
    }
    for (const e of ENTIDADES) expect(guia, e).toContain(`\`${e}\``);
    for (const h of ['Authorization', 'X-Macuxi-Conector-Id', 'X-Macuxi-Conector-Versao', 'Idempotency-Key', 'Idempotent-Replay', 'Retry-After', 'X-Request-Id']) {
      expect(guia, h).toContain(h);
    }
  });

  it('RN-INT-04: a tabela de ordem de carga do guia repete as dependências reais de domain/ordem.ts', () => {
    const tabela = guia.split('## 4. Ordem de carga')[1]?.split('Sequência segura')[0] ?? '';
    const esperadas: [string, string[]][] = Object.entries(DEPENDENCIAS).map(([e, deps]) => [e, [...deps]]);
    for (const [entidade, deps] of esperadas) {
      const linha = tabela.split('\n').find((l) => l.startsWith('|') && l.split('|')[1]?.includes(`\`${entidade}\``));
      expect(linha, `linha de ${entidade}`).toBeDefined();
      const direita = linha?.split('|')[2] ?? '';
      for (const d of deps) expect(direita, `${entidade} depende de ${d}`).toContain(`\`${d}\``);
      if (deps.length === 0) expect(direita).toContain('nada');
    }
  });

  it('os limites do guia são os padrões do Hub (PARAMETROS_PADRAO)', () => {
    const p = PARAMETROS_PADRAO;
    expect([p.limiteRegistrosLote, p.limiteLinhasInvalidas, p.limiteCorpoLoteBytes / 2 ** 20, p.limiteCorpoGeralBytes / 2 ** 20]).toEqual([5000, 500, 8, 1]);
    expect([p.taxaPorConector.lote.capacidade, p.taxaPorConector.lote.reposicaoPorMin, p.taxaPorConector.geral.capacidade, p.taxaPorConector.geral.reposicaoPorMin]).toEqual([30, 20, 300, 300]);
    expect([p.timeoutEnvioMin, p.limiteInativacaoPct, p.ttlConfirmacaoInativacaoDias, p.pedidosPorConsulta, p.esperaMaxDependenciaMin]).toEqual([10, 30, 7, 50, 30]);
    expect([p.ttlSessaoMin, p.convivenciaChaveMin, p.convivenciaChaveMaxMin, p.sinalAtrasadoMin, p.sinalAlertaMin]).toEqual([1440, 1440, 10080, 3, 15]);
    for (const trecho of ['5.000', '8 MiB', '1 MiB', '| 500 |', 'balde de 30 chamadas, repõe 20 por minuto', 'balde de 300, repõe 300 por minuto', 'Mais de 20 falhas', '30 %', '7 dias', '10 minutos', '30 minutos', '24 horas', '24 h']) {
      expect(guia, trecho).toContain(trecho);
    }
  });
});
