/**
 * T-0121 (ADR 0009 §5): poda local das entidades com janela. A linha que sai da janela do provedor (`data >= hoje − 40`)
 * não volta mais pelo pull (o cursor já passou por ela) e o servidor não a apaga: o motor apaga do aparelho, depois do
 * pull da entidade, as linhas com `naJanela(linha, hoje) === false`. `hoje` tem folga de 24 h (nunca apaga o que o
 * servidor ainda manda); a poda roda uma vez por dia; linha da fila/sobreposta, predicado que lança e entidade sem
 * `naJanela` ficam. Roda nos 3 armazenamentos (chave→JSON, linhas, SQLite real).
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, type ArmazenamentoSync, type TransporteSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarRegistroSync, definirEntidadeSync, diasAntes, hojeParaPoda, mesesAntes, SYNC_NAO_IMPLEMENTADO, type LinhaSync, type PaginaSync } from './sync';

const manifestos = [defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['visita', 'cliente'] })];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// hora-fixa-ok: relógio injetado do motor, nunca comparado ao relógio real
const AGORA = new Date('2026-11-09T03:00:00Z'); // 08/11 23h em Manaus: o "hoje" do tenant ainda é 08/11
const DIA = 24 * 60 * 60 * 1000;

describe('hojeParaPoda, diasAntes e mesesAntes (ADR 0009 §5)', () => {
  it('hoje da poda = data UTC de 24 h antes (nunca depois do hoje de um fuso do Brasil)', () => {
    expect(hojeParaPoda(AGORA)).toBe('2026-11-08');
    expect(hojeParaPoda(new Date('2026-11-09T02:59:59Z'))).toBe('2026-11-08');
    expect(hojeParaPoda(new Date('2026-11-08T00:30:00Z'))).toBe('2026-11-07'); // 07/11 20h30 em Manaus
  });
  it('diasAntes e mesesAntes no calendário, com fim de mês', () => {
    expect(diasAntes('2026-11-08', 40)).toBe('2026-09-29');
    expect(diasAntes('2026-03-01', 1)).toBe('2026-02-28');
    expect(mesesAntes('2026-03-31', 1)).toBe('2026-02-28');
    expect(mesesAntes('2028-03-31', 1)).toBe('2028-02-29');
    expect(mesesAntes('2026-01-15', 12)).toBe('2025-01-15');
    expect(() => diasAntes('08/11/2026', 1)).toThrow('AAAA-MM-DD');
  });
});

/** Servidor de pull que devolve, de uma vez, as linhas com `updated_at` depois do cursor (ordem do cursor). */
function servidor(fontes: Record<string, LinhaSync[]>) {
  const transporte: TransporteSync = {
    async push(itens) {
      // mantém o item na fila (retentável): ele protege a linha da poda
      return itens.map((i) => ({ id: i.id, status: 'rejeitado' as const, codigo: SYNC_NAO_IMPLEMENTADO, mensagem: 'ainda não' }));
    },
    async pull(entidade: string, cursor: string | null): Promise<PaginaSync<LinhaSync>> {
      const desde = cursor ? cursor.split('|')[0]! : '';
      const itens = (fontes[entidade] ?? []).filter((l) => l.updated_at > desde).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      return { itens, proximo_cursor: null };
    },
  };
  return transporte;
}

function registro(chamadas: string[]) {
  const r = criarRegistroSync(manifestos);
  r.registrar(
    definirEntidadeSync({
      nome: 'visita',
      modulo: 'core',
      direcao: 'ambos',
      conflito: 'app_edita_ate_status',
      schema: z.object({ id: z.string() }),
      // espelho de `data >= {{hoje}} - 40` (modules/core/api/sync.ts)
      naJanela: (l, hoje) => {
        chamadas.push(hoje);
        if (l.data === 'lança') throw new Error('linha estranha');
        return typeof l.data !== 'string' || l.data >= diasAntes(hoje, 40);
      },
    }),
  );
  r.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ nome: z.string() }) }));
  return r;
}

const linha = (n: number, campos: Record<string, unknown>): LinhaSync =>
  ({ id: uuid(n), updated_at: new Date(AGORA.getTime() - 60 * DIA + n * 1000).toISOString(), deleted_at: null, external_id: null, ...campos }) as LinhaSync;

describe.each(FABRICAS_ARMAZENAMENTO)('T-0121: poda local por janela (ADR 0009 §5) [%s]', (_nome, fabrica) => {
  async function abrir(armazenamento: ArmazenamentoSync, fontes: Record<string, LinhaSync[]>, relogio: { t: number }, chamadas: string[] = []) {
    const motor = criarMotorSync({ registro: registro(chamadas), armazenamento, transporte: servidor(fontes), agora: () => new Date(relogio.t) });
    await motor.carregar();
    if (motor.estado().modulosAtivos.length === 0) await motor.aplicarModulosAtivos(['core']);
    return motor;
  }
  const ids = async (m: Awaited<ReturnType<typeof abrir>>, e: string) => (await m.linhas(e)).map((l) => l.id).sort();

  it('apaga só o que saiu da janela, com folga de um dia; entidade sem naJanela não é podada', async () => {
    const armazenamento = fabrica();
    const relogio = { t: AGORA.getTime() };
    const fontes = {
      // hoje da poda = 2026-11-08 → limite 2026-09-29
      visita: [
        linha(1, { data: '2026-09-28' }), // fora
        linha(2, { data: '2026-09-29' }), // no limite: fica
        linha(3, { data: '2026-11-08' }),
        linha(4, {}), // sem data: na dúvida, fica
        linha(5, { data: 'lança' }), // predicado lança: fica
      ],
      cliente: [linha(10, { nome: 'Antigo' })],
    };
    const motor = await abrir(armazenamento, fontes, relogio);
    expect(await motor.sincronizar()).toBe(true);
    expect(await ids(motor, 'visita')).toEqual([uuid(2), uuid(3), uuid(4), uuid(5)]);
    expect(await ids(motor, 'cliente')).toEqual([uuid(10)]);
    expect(await armazenamento.ler('sync:poda:visita')).toBe('2026-11-08');
    expect(await armazenamento.ler('sync:poda:cliente')).toBeNull();
  });

  it('a linha do dia limite no fuso do tenant (Manaus) não é apagada antes da hora: a folga de 24 h segura', async () => {
    const armazenamento = fabrica();
    // 09/11 03h UTC = 08/11 23h em Manaus: o servidor ainda manda data >= 29/09 (hoje 08/11 − 40)
    const relogio = { t: AGORA.getTime() };
    const motor = await abrir(armazenamento, { visita: [linha(1, { data: '2026-09-29' })] }, relogio);
    await motor.sincronizar();
    expect(await ids(motor, 'visita')).toEqual([uuid(1)]);
    // dois dias depois ela sai (hoje da poda 10/11 → limite 01/10)
    relogio.t += 2 * DIA;
    await motor.sincronizar();
    expect(await ids(motor, 'visita')).toEqual([]);
  });

  it('roda no máximo uma vez por dia; no dia seguinte poda o que saiu', async () => {
    const armazenamento = fabrica();
    const relogio = { t: AGORA.getTime() };
    const chamadas: string[] = [];
    const motor = await abrir(armazenamento, { visita: [linha(1, { data: '2026-09-29' }), linha(2, { data: '2026-11-01' })] }, relogio, chamadas);
    await motor.sincronizar();
    const naPrimeira = chamadas.length;
    expect(naPrimeira).toBe(2);
    await motor.sincronizar();
    expect(chamadas.length).toBe(naPrimeira); // mesmo dia: não relê as linhas
    relogio.t += DIA;
    await motor.sincronizar();
    expect(chamadas.at(-1)).toBe('2026-11-09');
    expect(await ids(motor, 'visita')).toEqual([uuid(2)]);
  });

  it('linha com item na fila (ou citada no payload) não é podada', async () => {
    const armazenamento = fabrica();
    const relogio = { t: AGORA.getTime() };
    const motor = await abrir(armazenamento, { visita: [linha(1, { data: '2026-01-01' }), linha(2, { data: '2026-01-02' }), linha(3, { data: '2026-01-03' })] }, relogio);
    await motor.enfileirar({ id: uuid(1), entidade: 'visita', payload: { id: uuid(1) } });
    await motor.enfileirar({ id: uuid(99), entidade: 'visita', payload: { id: uuid(99), visita_id: uuid(2) } });
    await motor.sincronizar();
    expect(motor.estado().fila.map((i) => i.situacao)).toEqual(['pendente', 'pendente']);
    expect(await ids(motor, 'visita')).toEqual([uuid(1), uuid(2)]);
  });
});
