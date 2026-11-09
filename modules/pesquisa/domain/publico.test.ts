import { describe, expect, it } from 'vitest';
import { frequenciaPermite, pesquisaAplicavel, publicoContemCliente, publicoContemUsuario, vigenteEm } from './publico';
import type { PublicoAlvo, Questionario } from '../contracts';
import { QUEST, TENANT, publicada, u, versao } from './util-teste';

const publico = (p: Partial<PublicoAlvo> = {}): PublicoAlvo => ({ perfis: [], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [], ...p });
const usuario = (perfil = 'vendedor', equipe_ids: string[] = [u(50)]) => ({ id: u(1), perfil, equipe_ids });
const cliente = (extra: Partial<{ segmento: string | null; regiao: string | null; canal: string | null }> = {}) => ({ id: u(60), segmento: 'Atacado', regiao: 'Norte', canal: 'Tradicional' as string | null, ...extra });
const q: Questionario = { id: QUEST, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null };

describe('RF-PES-02: público-alvo do usuário (perfis e equipes)', () => {
  it('RF-PES-02: público vazio = todos', () => {
    expect(publicoContemUsuario(publico(), usuario('promotor'))).toBe(true);
  });
  it('RF-PES-02: perfil precisa estar na lista', () => {
    const p = publico({ perfis: ['promotor'] });
    expect(publicoContemUsuario(p, usuario('promotor'))).toBe(true);
    expect(publicoContemUsuario(p, usuario('vendedor'))).toBe(false);
  });
  it('RF-PES-02: equipe — vale a equipe do usuário ou uma acima dela na árvore', () => {
    const p = publico({ equipes: [u(40)] });
    expect(publicoContemUsuario(p, usuario('vendedor', [u(50), u(40)]))).toBe(true);
    expect(publicoContemUsuario(p, usuario('vendedor', [u(50)]))).toBe(false);
    expect(publicoContemUsuario(p, usuario('vendedor', []))).toBe(false);
  });
  it('RF-PES-02: perfil e equipe preenchidos valem juntos (E)', () => {
    const p = publico({ perfis: ['vendedor'], equipes: [u(50)] });
    expect(publicoContemUsuario(p, usuario('vendedor', [u(50)]))).toBe(true);
    expect(publicoContemUsuario(p, usuario('promotor', [u(50)]))).toBe(false);
  });
});

describe('RF-PES-02: público-alvo do cliente (segmento, canal, região, lista)', () => {
  it('RF-PES-02: sem critério de cliente, vale para qualquer cliente e também sem cliente (avulsa)', () => {
    expect(publicoContemCliente(publico(), cliente())).toBe(true);
    expect(publicoContemCliente(publico(), null)).toBe(true);
  });
  it('RN-PES-05: segmento e região são lidos sem diferenciar maiúsculas e valem juntos (E)', () => {
    const p = publico({ segmentos: ['atacado', 'varejo'], regioes: ['norte'] });
    expect(publicoContemCliente(p, cliente())).toBe(true);
    expect(publicoContemCliente(p, cliente({ regiao: 'Sul' }))).toBe(false);
    expect(publicoContemCliente(p, cliente({ segmento: null }))).toBe(false);
    expect(publicoContemCliente(publico({ regioes: ['Sul'] }), cliente())).toBe(false);
  });
  it('RF-PES-02: lista de clientes soma aos critérios (OU): cliente na lista entra mesmo fora do segmento', () => {
    const p = publico({ segmentos: ['Varejo'], clientes: [u(60)] });
    expect(publicoContemCliente(p, cliente())).toBe(true);
    expect(publicoContemCliente(p, { ...cliente(), id: u(61) })).toBe(false);
  });
  it('RF-PES-02: pesquisa com critério de cliente não se aplica quando não há cliente em contexto', () => {
    expect(publicoContemCliente(publico({ segmentos: ['Atacado'] }), null)).toBe(false);
    expect(publicoContemCliente(publico({ clientes: [u(60)] }), null)).toBe(false);
  });
});

describe('RN-PES-05: público legado sem canais (T-0115)', () => {
  it('RN-PES-05: público gravado antes de canais não lança erro e mantém o comportamento anterior', () => {
    const legado = { perfis: [], equipes: [], segmentos: ['Atacado'], regioes: [], clientes: [] } as unknown as PublicoAlvo;
    expect(() => publicoContemCliente(legado, cliente())).not.toThrow();
    expect(publicoContemCliente(legado, cliente())).toBe(true);
    expect(publicoContemCliente(legado, cliente({ segmento: 'Varejo' }))).toBe(false);
    expect(publicoContemCliente({ ...legado, segmentos: [] } as unknown as PublicoAlvo, null)).toBe(true);
  });
});

describe('RN-PES-05: canal do cliente no público-alvo (T-0115)', () => {
  it('RN-PES-05: só canal — o cliente entra se o canal dele estiver na lista, sem diferenciar maiúsculas, acentos e espaços', () => {
    const p = publico({ canais: [' tradicional ', 'Auto Serviço'] });
    expect(publicoContemCliente(p, cliente())).toBe(true);
    expect(publicoContemCliente(p, cliente({ canal: 'AUTO SERVICO' }))).toBe(true);
    expect(publicoContemCliente(p, cliente({ canal: 'Atacarejo' }))).toBe(false);
  });
  it('RN-PES-05: cliente sem canal (nulo ou ausente) não casa por canal', () => {
    const p = publico({ canais: ['Tradicional'] });
    expect(publicoContemCliente(p, cliente({ canal: null }))).toBe(false);
    expect(publicoContemCliente(p, { id: u(60), segmento: 'Atacado', regiao: null })).toBe(false);
  });
  it('RN-PES-05: canal soma (OU) aos segmentos e à lista de clientes', () => {
    const p = publico({ segmentos: ['Varejo'], canais: ['Tradicional'] });
    expect(publicoContemCliente(p, cliente())).toBe(true); // casa só pelo canal
    expect(publicoContemCliente(p, cliente({ canal: 'Outro', segmento: 'Varejo' }))).toBe(true); // só pelo segmento
    expect(publicoContemCliente(p, cliente({ canal: 'Outro' }))).toBe(false);
    const q2 = publico({ canais: ['Farma'], clientes: [u(60)] });
    expect(publicoContemCliente(q2, cliente())).toBe(true); // só pela lista
  });
  it('RN-PES-05: com canal definido e sem cliente em contexto, não se aplica', () => {
    expect(publicoContemCliente(publico({ canais: ['Tradicional'] }), null)).toBe(false);
  });
  it('RN-PES-05 / RF-PES-02: pesquisa só para um canal recusa cliente de outro canal com motivo de cliente', () => {
    const ctx = { usuario: usuario(), cliente: cliente({ canal: 'Outro' }), agora: '2026-10-31T15:00:00Z', visita_id: null, respostas_anteriores: [], fuso: 'America/Manaus' };
    expect(pesquisaAplicavel(q, [publicada({ publico_alvo: publico({ canais: ['Tradicional'] }) })], ctx)).toMatchObject({ aplicavel: false, motivo: 'CLIENTE_FORA_DO_PUBLICO' });
  });
});

describe('RF-PES-02 / RN-PES-04: vigência (UTC, início e fim inclusivos)', () => {
  const v = { inicio: '2026-10-01T04:00:00Z', fim: '2026-10-31T03:59:59Z' };
  it('RF-PES-02: dentro, nos limites e fora', () => {
    expect(vigenteEm(v, '2026-10-15T12:00:00Z')).toBe(true);
    expect(vigenteEm(v, '2026-10-01T04:00:00Z')).toBe(true);
    expect(vigenteEm(v, '2026-10-31T03:59:59Z')).toBe(true);
    expect(vigenteEm(v, '2026-10-31T04:00:00Z')).toBe(false);
    expect(vigenteEm(v, '2026-09-30T23:59:59Z')).toBe(false);
  });
  it('RF-PES-02: fim nulo = sem prazo', () => {
    expect(vigenteEm({ inicio: v.inicio, fim: null }, '2035-01-01T00:00:00Z')).toBe(true);
  });
});

describe('RN-PES-02: frequência — quando a pesquisa reaparece', () => {
  const ctx = { questionario_id: QUEST, usuario_id: u(1), cliente_id: u(60) as string | null, visita_id: u(70) as string | null, agora: '2026-10-31T15:00:00Z', fuso: 'America/Manaus' };
  const antes = (extra: Partial<{ usuario_id: string; cliente_id: string | null; visita_id: string | null; respondida_em: string }> = {}) => ({
    questionario_id: QUEST,
    usuario_id: u(1),
    cliente_id: u(60) as string | null,
    visita_id: u(71) as string | null,
    respondida_em: '2026-10-20T15:00:00Z',
    ...extra,
  });

  it('RN-PES-02: uma vez por cliente — depois de respondida para o cliente, nunca mais (inclusive por outro usuário)', () => {
    expect(frequenciaPermite('uma_vez_por_cliente', [], ctx).permite).toBe(true);
    const r = frequenciaPermite('uma_vez_por_cliente', [antes({ usuario_id: u(2) })], ctx);
    expect(r).toMatchObject({ permite: false, motivo: 'JA_RESPONDIDA_PARA_O_CLIENTE', liberada_em: null });
    expect(frequenciaPermite('uma_vez_por_cliente', [antes({ cliente_id: u(61) })], ctx).permite).toBe(true);
  });

  it('RN-PES-02: a cada visita — reaparece em toda visita nova e some na visita que já respondeu', () => {
    expect(frequenciaPermite('a_cada_visita', [antes()], ctx).permite).toBe(true);
    expect(frequenciaPermite('a_cada_visita', [antes({ visita_id: u(70) })], ctx)).toMatchObject({ permite: false, motivo: 'JA_RESPONDIDA_NA_VISITA' });
  });

  it('RN-PES-02: a cada visita sem visita em contexto (avulsa) não limita', () => {
    expect(frequenciaPermite('a_cada_visita', [antes({ visita_id: u(70) })], { ...ctx, visita_id: null }).permite).toBe(true);
  });

  it('RN-PES-02: semanal — uma por semana civil (segunda a domingo, fuso do tenant); reaparece na segunda', () => {
    // 31/10/2026 é sábado; semana de 26/10 (segunda) a 01/11 (domingo).
    const r = frequenciaPermite('semanal', [antes({ respondida_em: '2026-10-26T13:00:00Z' })], ctx);
    expect(r).toMatchObject({ permite: false, motivo: 'JA_RESPONDIDA_NA_SEMANA', liberada_em: '2026-11-02' });
    expect(frequenciaPermite('semanal', [antes({ respondida_em: '2026-10-25T20:00:00Z' })], ctx).permite).toBe(true);
  });

  it('RN-PES-02: semanal usa o dia no fuso do tenant (domingo 22h em Manaus já é segunda em UTC, mas ainda é a semana anterior)', () => {
    // 2026-10-26T02:00Z = domingo 25/10, 22h em Manaus => semana anterior.
    expect(frequenciaPermite('semanal', [antes({ respondida_em: '2026-10-26T02:00:00Z' })], ctx).permite).toBe(true);
  });

  it('RN-PES-02: mensal — uma por mês civil; reaparece no dia 1º do mês seguinte', () => {
    const r = frequenciaPermite('mensal', [antes({ respondida_em: '2026-10-02T13:00:00Z' })], ctx);
    expect(r).toMatchObject({ permite: false, motivo: 'JA_RESPONDIDA_NO_MES', liberada_em: '2026-11-01' });
    expect(frequenciaPermite('mensal', [antes({ respondida_em: '2026-09-30T13:00:00Z' })], ctx).permite).toBe(true);
  });

  it('RN-PES-02: mensal em dezembro reaparece em janeiro do ano seguinte', () => {
    const r = frequenciaPermite('mensal', [antes({ respondida_em: '2026-12-10T13:00:00Z' })], { ...ctx, agora: '2026-12-20T13:00:00Z' });
    expect(r.liberada_em).toBe('2027-01-01');
  });

  it('RN-PES-02: sem cliente em contexto, a chave é o usuário', () => {
    const c = { ...ctx, cliente_id: null, visita_id: null };
    expect(frequenciaPermite('mensal', [antes({ cliente_id: null, respondida_em: '2026-10-02T13:00:00Z' })], c).permite).toBe(false);
    expect(frequenciaPermite('mensal', [antes({ cliente_id: null, usuario_id: u(2), respondida_em: '2026-10-02T13:00:00Z' })], c).permite).toBe(true);
    // resposta ligada a cliente não conta para a chave "usuário"
    expect(frequenciaPermite('mensal', [antes({ respondida_em: '2026-10-02T13:00:00Z' })], c).permite).toBe(true);
  });

  it('RN-PES-02: só respostas do mesmo questionário contam', () => {
    expect(frequenciaPermite('uma_vez_por_cliente', [{ ...antes(), questionario_id: u(999) }], ctx).permite).toBe(true);
  });
});

describe('RF-PES-02 / RF-PES-03: pesquisa aplicável a usuário, cliente e data', () => {
  const ctx = { usuario: usuario('vendedor', [u(50)]), cliente: cliente(), agora: '2026-10-31T15:00:00Z', visita_id: u(70) as string | null, respostas_anteriores: [], fuso: 'America/Manaus' };
  const v1 = publicada({ publico_alvo: publico({ perfis: ['vendedor'] }) });

  it('RF-PES-02: usuário, cliente e data dentro do público e da vigência: aplicável, e devolve a versão vigente', () => {
    const v2 = publicada({ id: u(701), numero: 2, publico_alvo: publico({ perfis: ['vendedor'] }) });
    const r = pesquisaAplicavel(q, [v1, v2], ctx);
    expect(r).toMatchObject({ aplicavel: true });
    expect(r.versao!.id).toBe(u(701));
  });

  it('RF-PES-02: motivos de recusa, na ordem — arquivada, sem versão publicada, vigência, perfil, equipe, cliente, frequência', () => {
    expect(pesquisaAplicavel({ ...q, arquivado_em: '2026-10-30T00:00:00Z' }, [v1], ctx)).toMatchObject({ aplicavel: false, motivo: 'QUESTIONARIO_ARQUIVADO' });
    expect(pesquisaAplicavel(q, [versao()], ctx)).toMatchObject({ aplicavel: false, motivo: 'SEM_VERSAO_PUBLICADA' });
    expect(pesquisaAplicavel(q, [publicada({ vigencia: { inicio: '2026-09-01T00:00:00Z', fim: '2026-10-01T00:00:00Z' } })], ctx)).toMatchObject({ motivo: 'FORA_DA_VIGENCIA' });
    expect(pesquisaAplicavel(q, [publicada({ publico_alvo: publico({ perfis: ['promotor'] }) })], ctx)).toMatchObject({ motivo: 'PERFIL_FORA_DO_PUBLICO' });
    expect(pesquisaAplicavel(q, [publicada({ publico_alvo: publico({ equipes: [u(41)] }) })], ctx)).toMatchObject({ motivo: 'EQUIPE_FORA_DO_PUBLICO' });
    expect(pesquisaAplicavel(q, [publicada({ publico_alvo: publico({ segmentos: ['Varejo'] }) })], ctx)).toMatchObject({ motivo: 'CLIENTE_FORA_DO_PUBLICO' });
    const resp = { questionario_id: QUEST, usuario_id: u(1), cliente_id: u(60), visita_id: u(70), respondida_em: '2026-10-31T14:00:00Z' };
    expect(pesquisaAplicavel(q, [publicada()], { ...ctx, respostas_anteriores: [resp] })).toMatchObject({ motivo: 'FREQUENCIA' });
  });

  it('RF-PES-02: a versão publicada mais nova decide a aplicabilidade (v2 mudou o público)', () => {
    const v2 = publicada({ id: u(701), numero: 2, publico_alvo: publico({ perfis: ['promotor'] }) });
    expect(pesquisaAplicavel(q, [v1, v2], ctx)).toMatchObject({ aplicavel: false, motivo: 'PERFIL_FORA_DO_PUBLICO' });
  });

  it('RF-PES-02: a mensagem de recusa vem em português', () => {
    const r = pesquisaAplicavel(q, [publicada({ publico_alvo: publico({ perfis: ['promotor'] }) })], ctx);
    expect(r.mensagem).toMatch(/perfil/i);
  });
});
