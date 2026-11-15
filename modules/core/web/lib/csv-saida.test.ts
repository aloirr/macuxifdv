/**
 * RD-0044/RD-0051: saída byte a byte de cada exportação CSV do core (BOM, `;`, CRLF, aspas e células que começam com
 * `=`, `+`, `-`, `@` ou tabulação). O esperado foi gravado com o código anterior à troca pelo `@macuxi/comum/csv`;
 * a troca não pode mudar nenhum byte. `JSON.stringify` deixa o `\r\n` e o `\t` visíveis no esperado; o BOM aparece como `<BOM>`.
 */
import { describe, expect, it } from 'vitest';
import type { DispositivoItem, FarolCliente, IndicadoresLista, LicencasEstado, LinhaMetaBko, RvPainel, VisitaBko } from '../../contracts';
import { csvDeAparelhos } from './aparelhos';
import { csvDaCarteira } from './carteira';
import { csvDoFarol } from './farol';
import { csvDeIndicadores } from './indicadores';
import { csvDeLicencas } from './licencas';
import { csvDeMetas } from './metas';
import { csvDeRv } from './plano-rv';
import { csvDeVisitas } from './visitas';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOSTIS = ['=SOMA(A1)', '+1', '-1', '@cmd', '\tA', 'Loja "Boa"'] as const;
const bytes = (csv: string) => JSON.stringify(csv).replace(/^"\uFEFF/, '"<BOM>');

describe('RD-0044/RD-0051: saída dos CSVs do core não muda com o comum', () => {
  it('aparelhos', () => {
    const d: DispositivoItem = { id: id(1), usuario_id: id(2), usuario_nome: 'Vera', nome: 'Aparelho', plataforma: 'android', ultimo_acesso_em: '2026-10-31T15:30:00.000Z', bloqueado_em: null };
    const csv = csvDeAparelhos([d, ...HOSTIS.map((h) => ({ ...d, nome: h, usuario_nome: h, bloqueado_em: '2026-10-31T16:00:00.000Z' }))], 'America/Manaus');
    expect(bytes(csv)).toMatchInlineSnapshot(`""<BOM>\\"Aparelho\\";\\"Usuário\\";\\"Plataforma\\";\\"Último acesso\\";\\"Situação\\";\\"Bloqueado em\\"\\r\\n\\"Aparelho\\";\\"Vera\\";\\"android\\";\\"31/10/2026, 11:30\\";\\"Liberado\\";\\"\\"\\r\\n\\"=SOMA(A1)\\";\\"=SOMA(A1)\\";\\"android\\";\\"31/10/2026, 11:30\\";\\"Bloqueado\\";\\"31/10/2026, 12:00\\"\\r\\n\\"+1\\";\\"+1\\";\\"android\\";\\"31/10/2026, 11:30\\";\\"Bloqueado\\";\\"31/10/2026, 12:00\\"\\r\\n\\"-1\\";\\"-1\\";\\"android\\";\\"31/10/2026, 11:30\\";\\"Bloqueado\\";\\"31/10/2026, 12:00\\"\\r\\n\\"@cmd\\";\\"@cmd\\";\\"android\\";\\"31/10/2026, 11:30\\";\\"Bloqueado\\";\\"31/10/2026, 12:00\\"\\r\\n\\"\\tA\\";\\"\\tA\\";\\"android\\";\\"31/10/2026, 11:30\\";\\"Bloqueado\\";\\"31/10/2026, 12:00\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"android\\";\\"31/10/2026, 11:30\\";\\"Bloqueado\\";\\"31/10/2026, 12:00\\"\\r\\n""`);
  });

  it('carteira', () => {
    const c = { id: id(21), nome: 'Auto Um', razao_social: 'Auto Um Ltda', cidade: 'Manaus', bairro: null, lat: null, lng: null, ultima_compra_em: null, frequencia_semanas: 2, dia_semana: 5 };
    const csv = csvDaCarteira([c, ...HOSTIS.map((h) => ({ ...c, nome: h, cidade: h, bairro: h, lat: -3.1, lng: -60, ultima_compra_em: '2026-10-02', frequencia_semanas: 1, dia_semana: 1 }))], '=Vera');
    expect(bytes(csv)).toMatchInlineSnapshot(`""<BOM>\\"Usuário\\";\\"Cliente\\";\\"Cidade\\";\\"Bairro\\";\\"Última compra\\";\\"Frequência\\";\\"Dia da visita\\";\\"Coordenada\\"\\r\\n\\"=Vera\\";\\"Auto Um\\";\\"Manaus\\";\\"\\";\\"\\";\\"A cada 2 semanas\\";\\"Sexta\\";\\"sem coordenada\\"\\r\\n\\"=Vera\\";\\"=SOMA(A1)\\";\\"=SOMA(A1)\\";\\"=SOMA(A1)\\";\\"2026-10-02\\";\\"Toda semana\\";\\"Segunda\\";\\"ok\\"\\r\\n\\"=Vera\\";\\"+1\\";\\"+1\\";\\"+1\\";\\"2026-10-02\\";\\"Toda semana\\";\\"Segunda\\";\\"ok\\"\\r\\n\\"=Vera\\";\\"-1\\";\\"-1\\";\\"-1\\";\\"2026-10-02\\";\\"Toda semana\\";\\"Segunda\\";\\"ok\\"\\r\\n\\"=Vera\\";\\"@cmd\\";\\"@cmd\\";\\"@cmd\\";\\"2026-10-02\\";\\"Toda semana\\";\\"Segunda\\";\\"ok\\"\\r\\n\\"=Vera\\";\\"\\tA\\";\\"\\tA\\";\\"\\tA\\";\\"2026-10-02\\";\\"Toda semana\\";\\"Segunda\\";\\"ok\\"\\r\\n\\"=Vera\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"2026-10-02\\";\\"Toda semana\\";\\"Segunda\\";\\"ok\\"\\r\\n""`);
  });

  it('farol', () => {
    const c: FarolCliente = { cliente_id: 'c1', nome: 'Loja', documento_mascarado: '12.345.678/****-**', usuario_id: 'v1', ultima_compra_em: '2026-10-02', dias_sem_compra: 34, positivado_mes: true, cor: 'verde' };
    const csv = csvDoFarol([c, ...HOSTIS.map((h) => ({ ...c, nome: h, documento_mascarado: h, ultima_compra_em: null, dias_sem_compra: null, positivado_mes: false, cor: 'sem_compra' as const }))], (u) => (u === 'v1' ? '-Ana' : 'Ana'));
    expect(bytes(csv)).toMatchInlineSnapshot(`""<BOM>\\"Cliente\\";\\"Documento\\";\\"Vendedor\\";\\"Última compra\\";\\"Dias sem compra\\";\\"Positivado no mês\\";\\"Farol\\"\\r\\n\\"Loja\\";\\"12.345.678/****-**\\";\\"'-Ana\\";\\"02/10/2026\\";\\"34\\";\\"Sim\\";\\"Verde\\"\\r\\n\\"'=SOMA(A1)\\";\\"'=SOMA(A1)\\";\\"'-Ana\\";\\"—\\";\\"sem compra\\";\\"Não\\";\\"Sem compra\\"\\r\\n\\"'+1\\";\\"'+1\\";\\"'-Ana\\";\\"—\\";\\"sem compra\\";\\"Não\\";\\"Sem compra\\"\\r\\n\\"'-1\\";\\"'-1\\";\\"'-Ana\\";\\"—\\";\\"sem compra\\";\\"Não\\";\\"Sem compra\\"\\r\\n\\"'@cmd\\";\\"'@cmd\\";\\"'-Ana\\";\\"—\\";\\"sem compra\\";\\"Não\\";\\"Sem compra\\"\\r\\n\\"'\\tA\\";\\"'\\tA\\";\\"'-Ana\\";\\"—\\";\\"sem compra\\";\\"Não\\";\\"Sem compra\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"'-Ana\\";\\"—\\";\\"sem compra\\";\\"Não\\";\\"Sem compra\\"\\r\\n""`);
  });

  it('indicadores', () => {
    const lista = {
      periodo: '2026-10',
      base_apuracao: 'aprovado',
      itens: HOSTIS.map((h, i) => ({
        usuario_id: id(i + 1),
        usuario_nome: h,
        indicadores: { planejados: 2, visitados: 1, cobertura_pct: 5000, positivados: 0, carteira: 3, realizado_cents: 400_00, pedidos: 1 },
        metas: [{ indicador: 'venda_cents', meta: 1_000_00, realizado: 400_00, atingimento_pct: 4000 }],
      })),
    } as unknown as IndicadoresLista;
    expect(bytes(csvDeIndicadores(lista))).toMatchInlineSnapshot(`""<BOM>\\"Vendedor ou promotor\\";\\"Visitados\\";\\"Cobertura\\";\\"Positivados\\";\\"Realizado\\";\\"Meta de venda\\";\\"Atingimento\\";\\"Necessidade diária\\"\\r\\n\\"=SOMA(A1)\\";\\"1 de 2\\";\\"50,00%\\";\\"0\\";\\"R$ 400\\";\\"R$ 1.000\\";\\"40,00%\\";\\"Sem meta de venda definida para o mês.\\"\\r\\n\\"+1\\";\\"1 de 2\\";\\"50,00%\\";\\"0\\";\\"R$ 400\\";\\"R$ 1.000\\";\\"40,00%\\";\\"Sem meta de venda definida para o mês.\\"\\r\\n\\"-1\\";\\"1 de 2\\";\\"50,00%\\";\\"0\\";\\"R$ 400\\";\\"R$ 1.000\\";\\"40,00%\\";\\"Sem meta de venda definida para o mês.\\"\\r\\n\\"@cmd\\";\\"1 de 2\\";\\"50,00%\\";\\"0\\";\\"R$ 400\\";\\"R$ 1.000\\";\\"40,00%\\";\\"Sem meta de venda definida para o mês.\\"\\r\\n\\"\\tA\\";\\"1 de 2\\";\\"50,00%\\";\\"0\\";\\"R$ 400\\";\\"R$ 1.000\\";\\"40,00%\\";\\"Sem meta de venda definida para o mês.\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"1 de 2\\";\\"50,00%\\";\\"0\\";\\"R$ 400\\";\\"R$ 1.000\\";\\"40,00%\\";\\"Sem meta de venda definida para o mês.\\"\\r\\n""`);
  });

  it('licenças', () => {
    const e: LicencasEstado = {
      modulos: ['core', 'catalogo', 'vendedor', 'promotor'],
      dependencias: { catalogo: ['core'], vendedor: ['core', 'catalogo'], promotor: ['core'] },
      tenant: { core: true, catalogo: true, vendedor: true, promotor: false },
      perfis: { vendedor: ['core', 'catalogo', 'vendedor'], promotor: ['core', 'promotor'] },
      usuarios: HOSTIS.map((h, i) => ({ id: id(i + 1), nome: h, email: h, perfil: 'vendedor' as const, removidos: i === 0 ? ['vendedor' as const] : [] })),
    };
    expect(bytes(csvDeLicencas(e))).toMatchInlineSnapshot(`""<BOM>\\"nivel\\";\\"alvo\\";\\"modulo\\";\\"estado\\"\\r\\n\\"tenant\\";\\"empresa\\";\\"core\\";\\"ativo\\"\\r\\n\\"tenant\\";\\"empresa\\";\\"catalogo\\";\\"ativo\\"\\r\\n\\"tenant\\";\\"empresa\\";\\"vendedor\\";\\"ativo\\"\\r\\n\\"tenant\\";\\"empresa\\";\\"promotor\\";\\"inativo\\"\\r\\n\\"perfil\\";\\"vendedor\\";\\"core\\";\\"ativo\\"\\r\\n\\"perfil\\";\\"vendedor\\";\\"catalogo\\";\\"ativo\\"\\r\\n\\"perfil\\";\\"vendedor\\";\\"vendedor\\";\\"ativo\\"\\r\\n\\"perfil\\";\\"vendedor\\";\\"promotor\\";\\"inativo\\"\\r\\n\\"perfil\\";\\"promotor\\";\\"core\\";\\"ativo\\"\\r\\n\\"perfil\\";\\"promotor\\";\\"catalogo\\";\\"inativo\\"\\r\\n\\"perfil\\";\\"promotor\\";\\"vendedor\\";\\"inativo\\"\\r\\n\\"perfil\\";\\"promotor\\";\\"promotor\\";\\"ativo\\"\\r\\n\\"usuario\\";\\"=SOMA(A1)\\";\\"vendedor\\";\\"removido\\"\\r\\n\\"efetivos\\";\\"=SOMA(A1)\\";\\"core catalogo\\";\\"efetivo\\"\\r\\n\\"efetivos\\";\\"+1\\";\\"core catalogo vendedor\\";\\"efetivo\\"\\r\\n\\"efetivos\\";\\"-1\\";\\"core catalogo vendedor\\";\\"efetivo\\"\\r\\n\\"efetivos\\";\\"@cmd\\";\\"core catalogo vendedor\\";\\"efetivo\\"\\r\\n\\"efetivos\\";\\"\\tA\\";\\"core catalogo vendedor\\";\\"efetivo\\"\\r\\n\\"efetivos\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"core catalogo vendedor\\";\\"efetivo\\"\\r\\n""`);
  });

  it('metas', () => {
    const l: LinhaMetaBko = { usuario_id: id(1), usuario_nome: 'Ana', equipe_id: null, indicador: 'venda_cents', tipo: 'pedido', meta: 2500000, realizado: 1000000, atingimento_pct: 4000, editavel: true };
    const csv = csvDeMetas([l, { ...l, meta: 0, atingimento_pct: null }, { ...l, realizado: -500, atingimento_pct: -20 }, ...HOSTIS.map((h) => ({ ...l, usuario_nome: h }))]);
    expect(bytes(csv)).toMatchInlineSnapshot(`""<BOM>\\"Vendedor ou promotor\\";\\"Indicador\\";\\"Tipo\\";\\"Meta\\";\\"Realizado\\";\\"Atingimento\\"\\r\\n\\"Ana\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"R$ 10.000\\";\\"40,00%\\"\\r\\n\\"Ana\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"—\\";\\"R$ 10.000\\";\\"—\\"\\r\\n\\"Ana\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"-R$ 5\\";\\"-0,20%\\"\\r\\n\\"=SOMA(A1)\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"R$ 10.000\\";\\"40,00%\\"\\r\\n\\"+1\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"R$ 10.000\\";\\"40,00%\\"\\r\\n\\"-1\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"R$ 10.000\\";\\"40,00%\\"\\r\\n\\"@cmd\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"R$ 10.000\\";\\"40,00%\\"\\r\\n\\"\\tA\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"R$ 10.000\\";\\"40,00%\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"Vendas\\";\\"Pedido aprovado\\";\\"R$ 25.000\\";\\"R$ 10.000\\";\\"40,00%\\"\\r\\n""`);
  });

  it('plano de RV (fechado e parcial)', () => {
    const pessoa: RvPainel['pessoas'][number] = {
      usuario_id: id(1),
      nome: 'Ana',
      equipe_id: null,
      rv_cents: 120_000,
      rv_bruta_cents: 120_000,
      bloqueada_por: [],
      indicadores: [
        { indicador: 'venda_cents', meta: 100_000, realizado: 90_000, atingimento_pbp: 9000, projetado_pbp: 9500, pagamento_pct: 90.5, valor_cents: 120_000, gatilho: true, gatilho_ok: false, sem_meta: false },
        { indicador: 'positivacao', meta: 0, realizado: 3, atingimento_pbp: 0, projetado_pbp: 0, pagamento_pct: 0, valor_cents: 0, gatilho: false, gatilho_ok: null, sem_meta: true },
      ],
    };
    const p: RvPainel = { periodo: '2026-10', situacao: 'fechado', fechamento_em: '2026-11-03', plano_id: id(9), pessoas: [pessoa, ...HOSTIS.map((h) => ({ ...pessoa, nome: h, bloqueada_por: ['venda_cents' as const] }))] };
    expect(bytes(csvDeRv(p))).toMatchInlineSnapshot(`""<BOM>\\"Pessoa\\";\\"Indicador\\";\\"Meta\\";\\"Realizado\\";\\"Atingimento\\";\\"Pago (%)\\";\\"Valor (R$)\\";\\"Gatilho\\";\\"RV da pessoa (R$)\\"\\r\\n\\"Ana\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"90%\\";\\"90,5\\";\\"1200,00\\";\\"Não atingido\\";\\"1200,00\\"\\r\\n\\"Ana\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'=SOMA(A1)\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"90%\\";\\"90,5\\";\\"1200,00\\";\\"Não atingido (RV zerada)\\";\\"1200,00\\"\\r\\n\\"'=SOMA(A1)\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'+1\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"90%\\";\\"90,5\\";\\"1200,00\\";\\"Não atingido (RV zerada)\\";\\"1200,00\\"\\r\\n\\"'+1\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'-1\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"90%\\";\\"90,5\\";\\"1200,00\\";\\"Não atingido (RV zerada)\\";\\"1200,00\\"\\r\\n\\"'-1\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'@cmd\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"90%\\";\\"90,5\\";\\"1200,00\\";\\"Não atingido (RV zerada)\\";\\"1200,00\\"\\r\\n\\"'@cmd\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'\\tA\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"90%\\";\\"90,5\\";\\"1200,00\\";\\"Não atingido (RV zerada)\\";\\"1200,00\\"\\r\\n\\"'\\tA\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"90%\\";\\"90,5\\";\\"1200,00\\";\\"Não atingido (RV zerada)\\";\\"1200,00\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"""`);
    expect(bytes(csvDeRv({ ...p, situacao: 'parcial' }))).toMatchInlineSnapshot(`""<BOM>\\"Pessoa\\";\\"Indicador\\";\\"Meta\\";\\"Realizado\\";\\"Atingimento projetado\\";\\"Pago (%)\\";\\"Valor (R$)\\";\\"Gatilho\\";\\"RV da pessoa (R$)\\"\\r\\n\\"Ana\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"95%\\";\\"90,5\\";\\"1200,00\\";\\"Ainda não atingido: se o mês fechar assim, a RV zera\\";\\"1200,00\\"\\r\\n\\"Ana\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'=SOMA(A1)\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"95%\\";\\"90,5\\";\\"1200,00\\";\\"Ainda não atingido: se o mês fechar assim, a RV zera\\";\\"1200,00\\"\\r\\n\\"'=SOMA(A1)\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'+1\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"95%\\";\\"90,5\\";\\"1200,00\\";\\"Ainda não atingido: se o mês fechar assim, a RV zera\\";\\"1200,00\\"\\r\\n\\"'+1\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'-1\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"95%\\";\\"90,5\\";\\"1200,00\\";\\"Ainda não atingido: se o mês fechar assim, a RV zera\\";\\"1200,00\\"\\r\\n\\"'-1\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'@cmd\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"95%\\";\\"90,5\\";\\"1200,00\\";\\"Ainda não atingido: se o mês fechar assim, a RV zera\\";\\"1200,00\\"\\r\\n\\"'@cmd\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"'\\tA\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"95%\\";\\"90,5\\";\\"1200,00\\";\\"Ainda não atingido: se o mês fechar assim, a RV zera\\";\\"1200,00\\"\\r\\n\\"'\\tA\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"Vendas\\";\\"R$ 1.000,00\\";\\"R$ 900,00\\";\\"95%\\";\\"90,5\\";\\"1200,00\\";\\"Ainda não atingido: se o mês fechar assim, a RV zera\\";\\"1200,00\\"\\r\\n\\"Loja \\"\\"Boa\\"\\"\\";\\"Positivação\\";\\"0\\";\\"3\\";\\"—\\";\\"0\\";\\"0,00\\";\\"\\";\\"1200,00\\"""`);
  });

  it('visitas', () => {
    const v: VisitaBko = {
      id: id(40), usuario_id: id(1), usuario_nome: 'Vera', cliente_id: id(21), cliente_nome: 'Auto', data_local: '2026-10-31', checkin_em: '2026-10-31T13:00:00Z', checkout_em: '2026-10-31T13:40:00Z',
      fora_do_raio: true, distancia_m: 850, justificativa_fora_raio: 'Atendeu ao lado', sem_gps: false, sugere_coordenada: false, extra: true, resultado: 'cliente_fechado', fechada_por: 'usuario',
      motivo_codigo: 'loja_fechada', motivo_descricao: 'Loja fechada', motivo_texto: null, foto_fachada_id: id(50), etapas: [],
    };
    const csv = csvDeVisitas([v, ...HOSTIS.map((h) => ({ ...v, usuario_nome: h, cliente_nome: h, justificativa_fora_raio: h, motivo_texto: h, checkout_em: null, resultado: null, foto_fachada_id: null, etapas_pendentes: 2 }))], 'America/Manaus');
    expect(bytes(csv)).toMatchInlineSnapshot(`""<BOM>\\"Data\\";\\"Vendedor\\";\\"Cliente\\";\\"Check-in\\";\\"Checkout\\";\\"Minutos\\";\\"Resultado\\";\\"Motivo\\";\\"Distância (m)\\";\\"Sinais\\";\\"Justificativa\\";\\"Foto da fachada\\";\\"Etapas pendentes\\"\\r\\n\\"2026-10-31\\";\\"Vera\\";\\"Auto\\";\\"31/10/2026, 09:00\\";\\"31/10/2026, 09:40\\";\\"40\\";\\"Cliente fechado\\";\\"Loja fechada\\";\\"850\\";\\"Fora do raio, Visita extra\\";\\"Atendeu ao lado\\";\\"sim\\";\\"0\\"\\r\\n\\"2026-10-31\\";\\"=SOMA(A1)\\";\\"=SOMA(A1)\\";\\"31/10/2026, 09:00\\";\\"\\";\\"\\";\\"Em atendimento\\";\\"Loja fechada\\";\\"850\\";\\"Fora do raio, Visita extra\\";\\"=SOMA(A1)\\";\\"\\";\\"2\\"\\r\\n\\"2026-10-31\\";\\"+1\\";\\"+1\\";\\"31/10/2026, 09:00\\";\\"\\";\\"\\";\\"Em atendimento\\";\\"Loja fechada\\";\\"850\\";\\"Fora do raio, Visita extra\\";\\"+1\\";\\"\\";\\"2\\"\\r\\n\\"2026-10-31\\";\\"-1\\";\\"-1\\";\\"31/10/2026, 09:00\\";\\"\\";\\"\\";\\"Em atendimento\\";\\"Loja fechada\\";\\"850\\";\\"Fora do raio, Visita extra\\";\\"-1\\";\\"\\";\\"2\\"\\r\\n\\"2026-10-31\\";\\"@cmd\\";\\"@cmd\\";\\"31/10/2026, 09:00\\";\\"\\";\\"\\";\\"Em atendimento\\";\\"Loja fechada\\";\\"850\\";\\"Fora do raio, Visita extra\\";\\"@cmd\\";\\"\\";\\"2\\"\\r\\n\\"2026-10-31\\";\\"\\tA\\";\\"\\tA\\";\\"31/10/2026, 09:00\\";\\"\\";\\"\\";\\"Em atendimento\\";\\"Loja fechada\\";\\"850\\";\\"Fora do raio, Visita extra\\";\\"\\tA\\";\\"\\";\\"2\\"\\r\\n\\"2026-10-31\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"31/10/2026, 09:00\\";\\"\\";\\"\\";\\"Em atendimento\\";\\"Loja fechada\\";\\"850\\";\\"Fora do raio, Visita extra\\";\\"Loja \\"\\"Boa\\"\\"\\";\\"\\";\\"2\\"\\r\\n""`);
  });
});
