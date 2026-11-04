import { describe, expect, it } from 'vitest';
import type { RecadoEnviado } from '../../contracts';
import { ACAO_RECADO_DO_DIA, agruparPorEnvio, ehRecadoDoDiaHoje, mensagemDoRecadoDoDia, podeMarcarRecadoDoDia } from './recado-do-dia';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FUSO = 'America/Manaus';
// 11/11 00:30Z ainda é 10/11 em Manaus
const AGORA = new Date('2026-11-11T00:30:00Z');
const linha = (n: number, envio: string | null, o: Partial<RecadoEnviado> = {}): RecadoEnviado => ({
  id: id(n), envio_id: envio, titulo: 'Meta da semana', prioridade: 'normal', autor_id: null, destinatario_id: id(50 + n), destinatario_nome: `P${n}`,
  enviada_em: '2026-11-10T10:00:00Z', lida_em: null, ...o,
});

describe('RN-CORE-26: recado do dia no BKO', () => {
  it('RN-CORE-26: é recado do dia hoje só com a data de hoje no fuso do tenant (não a data UTC)', () => {
    expect(ehRecadoDoDiaHoje('2026-11-10', AGORA, FUSO)).toBe(true);
    expect(ehRecadoDoDiaHoje('2026-11-11', AGORA, FUSO)).toBe(false);
    expect(ehRecadoDoDiaHoje('2026-11-09', AGORA, FUSO)).toBe(false);
    expect(ehRecadoDoDiaHoje(null, AGORA, FUSO)).toBe(false);
    expect(ehRecadoDoDiaHoje(undefined, AGORA, FUSO)).toBe(false);
  });
  it('RN-CORE-26: a ação é notificacao.recado_do_dia; sem ela (analista, admin) o botão não aparece', () => {
    expect(ACAO_RECADO_DO_DIA).toBe('notificacao.recado_do_dia');
    expect(podeMarcarRecadoDoDia(true, { envio_id: id(1) })).toBe(true);
    expect(podeMarcarRecadoDoDia(false, { envio_id: id(1) })).toBe(false);
    expect(podeMarcarRecadoDoDia(true, null)).toBe(false);
  });
  it('RN-CORE-26: agrupa por envio, conta leituras e marca o chip se qualquer linha vale hoje; linha sem envio_id fica de fora', () => {
    const itens = [
      linha(1, id(900), { lida_em: '2026-11-10T11:00:00Z', recado_do_dia: '2026-11-10' }),
      linha(2, id(900)),
      linha(3, id(901), { enviada_em: '2026-11-09T10:00:00Z', recado_do_dia: '2026-11-09' }),
      linha(4, null),
    ];
    const g = agruparPorEnvio(itens, AGORA, FUSO);
    expect(g.map((e) => [e.envio_id, e.destinatarios, e.lidas, e.recado_do_dia_hoje])).toEqual([
      [id(900), 2, 1, true],
      [id(901), 1, 0, false],
    ]);
  });
  it('RN-CORE-26: 422 RN-CORE-26 mostra a frase da API; sem frase, o texto padrão claro; outros erros seguem o texto padrão', () => {
    expect(mensagemDoRecadoDoDia({ status: 422, code: 'RN-CORE-26', message: 'Este recado é antigo demais para virar recado do dia. Envie um recado novo.' }, 'x')).toContain('antigo demais');
    expect(mensagemDoRecadoDoDia({ status: 422, code: 'RN-CORE-26', message: '' }, 'x')).toContain('Envie um recado novo');
    expect(mensagemDoRecadoDoDia({ status: 404, code: 'RECADO_NAO_ENCONTRADO', message: 'nf' }, 'x')).toContain('Atualize a página');
    expect(mensagemDoRecadoDoDia({ status: 500, code: 'E', message: 'boom' }, 'Tente de novo.')).toBe('Tente de novo.');
  });
});
