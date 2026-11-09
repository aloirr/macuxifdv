import {
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarRegistroSync,
  criarServidorSyncSimulado,
  type LinhaSync,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { ClienteContatoSync, ClienteEnderecoSync, ClienteFinanceiroSync, ClienteSync, HistoricoCompraSync, TituloSync } from '../../contracts';
import { manifest } from '../../manifest';
import { entidadesCliente } from './entidades-cliente';
import { somarDiasCivis as somarDias } from '@macuxi/comum/relogio';
import { agruparPorCliente, historicoNaJanela, listarClientesLocais, montarCliente360Local, tituloNaJanela } from './cliente360-local';

const HOJE = '2026-10-31';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { updated_at: '2026-10-31T10:00:00.000000Z', deleted_at: null, external_id: null };

const cliente = (n: number, nome: string, extra: Partial<ClienteSync> = {}): ClienteSync => ({
  ...base,
  id: id(n),
  documento: `0000000000${n}`,
  razao_social: `${nome} Ltda`,
  nome_fantasia: nome,
  segmento: 'Autopeças',
  telefone: '(92) 3222-0001',
  email: null,
  logradouro: 'Rua A',
  numero: '10',
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: null,
  latitude: '-3.100000',
  longitude: '-60.000000',
  ativo: true,
  ...extra,
});
const endereco = (n: number, cid: number, extra: Partial<ClienteEnderecoSync> = {}): ClienteEnderecoSync => ({
  ...base,
  id: id(n),
  cliente_id: id(cid),
  tipo: 'entrega',
  descricao: null,
  logradouro: `Rua ${n}`,
  numero: String(n),
  complemento: null,
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69000000',
  latitude: null,
  longitude: null,
  principal: false,
  ativo: true,
  ...extra,
});
const contato = (n: number, cid: number, nome: string, principal: boolean, tel: string | null, wa: string | null): ClienteContatoSync => ({
  ...base,
  id: id(n),
  cliente_id: id(cid),
  nome,
  cargo: null,
  telefone: tel,
  whatsapp: wa,
  email: null,
  principal,
});
const financeiro = (cid: number, limite: number, saldo: number, bloqueado = false): ClienteFinanceiroSync => ({
  ...base,
  id: id(500 + cid),
  cliente_id: id(cid),
  limite_cents: limite,
  saldo_aberto_cents: saldo,
  credito_disponivel_cents: null,
  bloqueado,
  motivo_bloqueio: bloqueado ? 'Títulos vencidos' : null,
  atualizado_erp_em: null,
});
const titulo = (n: number, cid: number, vencimento: string, saldo: number, situacao: TituloSync['situacao'] = 'aberto'): TituloSync => ({
  ...base,
  id: id(n),
  cliente_id: id(cid),
  documento: `NF-${n}`,
  parcela: null,
  emissao: somarDias(vencimento, -30),
  vencimento,
  valor_cents: saldo,
  saldo_cents: saldo,
  situacao,
  liquidado_em: null,
});
const compras = (n: number, cid: number, anoMes: string, valor: number, pedidos: number, ultima: string): HistoricoCompraSync => ({
  ...base,
  id: id(n),
  cliente_id: id(cid),
  ano_mes: anoMes,
  valor_cents: valor,
  pedidos,
  itens: pedidos * 3,
  ultima_compra_em: ultima,
  origem: 'erp',
});

describe('Cliente 360 montado só com as linhas locais (RF-CORE-04)', () => {
  const l = {
    cliente: cliente(1, 'Auto Peças Um'),
    contatos: [contato(11, 1, 'Rita Financeiro', false, '9232220002', null), contato(10, 1, 'Marcos Compras', true, '9232220001', '92999990001')],
    financeiro: financeiro(1, 5_000_000, 1_000_000),
    titulos: [titulo(21, 1, '2026-10-21', 500_000), titulo(22, 1, '2026-11-20', 500_000), titulo(23, 1, '2026-10-31', 100_000)],
    historico: [compras(31, 1, '2026-10', 800_000, 2, '2026-10-20'), compras(32, 1, '2026-09', 700_000, 1, '2026-09-10')],
  };

  it('RF-CORE-04: resumo financeiro — vencido, a vencer e crédito disponível (limite − saldo)', () => {
    const r = montarCliente360Local(l, HOJE);
    expect(r.resumo_financeiro).toMatchObject({ vencidos_qtd: 1, vencidos_cents: 500_000, a_vencer_qtd: 2, credito_disponivel_cents: 4_000_000, maior_atraso_dias: 10 });
  });

  it('RF-CORE-04: título que vence HOJE ainda é a vencer (não vencido)', () => {
    const r = montarCliente360Local(l, HOJE);
    expect(r.titulos.find((t) => t.id === id(23))).toMatchObject({ situacao_calculada: 'a_vencer', dias_atraso: 0 });
  });

  it('RF-CORE-04: resumo de compras — última compra, ticket médio e total de 12 meses', () => {
    const r = montarCliente360Local(l, HOJE);
    expect(r.resumo_compras).toMatchObject({ ultima_compra_em: '2026-10-20', dias_sem_compra: 11, total_12m_cents: 1_500_000, ticket_medio_cents: 500_000 });
  });

  it('RF-CORE-02: ligar e WhatsApp em 1 toque saem do contato principal, com DDI 55 e só dígitos', () => {
    const r = montarCliente360Local(l, HOJE);
    expect(r.contatos[0]!.nome).toBe('Marcos Compras');
    expect(r.ligar).toBe('tel:+559232220001');
    expect(r.whatsapp).toBe('https://wa.me/5592999990001');
  });

  it('RF-CORE-02: sem contato, liga pelo telefone do cadastro do cliente', () => {
    const r = montarCliente360Local({ ...l, contatos: [] }, HOJE);
    expect(r.ligar).toBe('tel:+559232220001');
    expect(montarCliente360Local({ ...l, contatos: [], cliente: cliente(1, 'X', { telefone: null }) }, HOJE).ligar).toBeNull();
  });

  it('RF-CORE-04: cliente sem histórico e sem financeiro (borda) não quebra a ficha', () => {
    const r = montarCliente360Local({ cliente: cliente(2, 'Novo'), contatos: [], financeiro: null, titulos: [], historico: [] }, HOJE);
    expect(r.resumo_financeiro).toBeNull();
    expect(r.resumo_compras).toMatchObject({ ultima_compra_em: null, dias_sem_compra: null, total_12m_cents: 0 });
  });

  it('desenho §2: título liquidado há mais de 90 dias e histórico além de 12 meses ficam fora da ficha', () => {
    expect(tituloNaJanela({ situacao: 'liquidado', vencimento: '2026-07-01' }, HOJE)).toBe(false);
    expect(tituloNaJanela({ situacao: 'liquidado', vencimento: '2026-08-15' }, HOJE)).toBe(true);
    expect(tituloNaJanela({ situacao: 'aberto', vencimento: '2025-01-01' }, HOJE)).toBe(true);
    expect(historicoNaJanela({ ano_mes: '2025-09' }, HOJE)).toBe(false);
    expect(historicoNaJanela({ ano_mes: '2025-10' }, HOJE)).toBe(true);
  });
});

describe('lista de Clientes do aparelho (desenho T-0016 §3.4)', () => {
  const clientes = [cliente(1, 'Auto Peças Um'), cliente(2, 'Borracharia Dois', { cidade: 'Parintins' }), cliente(3, 'Casa de Peças Três')];
  const baseLocal = {
    clientes,
    financeiros: [financeiro(1, 5_000_000, 0), financeiro(2, 100, 200, true)],
    titulos: [titulo(21, 1, '2026-10-21', 500), titulo(22, 2, '2026-12-01', 500)],
    historico: [compras(31, 1, '2026-10', 100, 1, '2026-10-25'), compras(32, 2, '2026-03', 100, 1, '2026-03-10')],
  };
  const nomes = (r: { nome_fantasia: string | null }[]) => r.map((c) => c.nome_fantasia);

  it('RF-CORE-02: lista ordenada por nome, com busca sem acento e sem diferença de caixa', () => {
    expect(nomes(listarClientesLocais(baseLocal, HOJE))).toEqual(['Auto Peças Um', 'Borracharia Dois', 'Casa de Peças Três']);
    expect(nomes(listarClientesLocais(baseLocal, HOJE, { q: 'PECAS' }))).toEqual(['Auto Peças Um', 'Casa de Peças Três']);
  });

  it('RF-CORE-02: filtro "vencidos" traz só quem tem título vencido', () => {
    expect(nomes(listarClientesLocais(baseLocal, HOJE, { comVencidos: true }))).toEqual(['Auto Peças Um']);
  });

  it('RF-CORE-02: filtro "bloqueados" usa o financeiro do ERP', () => {
    expect(nomes(listarClientesLocais(baseLocal, HOJE, { bloqueado: true }))).toEqual(['Borracharia Dois']);
  });

  it('RF-CORE-02: "sem compra há N dias" inclui quem nunca comprou', () => {
    expect(nomes(listarClientesLocais(baseLocal, HOJE, { semCompraHa: 45 }))).toEqual(['Borracharia Dois', 'Casa de Peças Três']);
    expect(nomes(listarClientesLocais(baseLocal, HOJE, { semCompraHa: 3 }))).toEqual(['Auto Peças Um', 'Borracharia Dois', 'Casa de Peças Três']);
  });

  it('RN-CORE-04: cliente removido do escopo (deleted_at) some da lista', () => {
    const removido = { ...baseLocal, clientes: [...clientes.slice(0, 2), { ...clientes[2]!, deleted_at: '2026-10-31T11:00:00.000000Z' }] };
    expect(listarClientesLocais(removido, HOJE)).toHaveLength(2);
  });

  it('agruparPorCliente junta as linhas de cada cliente', () => {
    expect(agruparPorCliente(baseLocal.titulos).get(id(1))).toHaveLength(1);
  });
});

describe('RF-CORE-12 / RN-VEN-17: endereços de entrega na ficha local', () => {
  const l = { cliente: cliente(1, 'Auto Peças Um'), contatos: [], financeiro: null, titulos: [], historico: [] };

  it('RN-VEN-17: a ficha traz os endereços ativos do cliente, o principal primeiro e marcado como padrão', () => {
    const ficha = montarCliente360Local(
      { ...l, enderecos: [endereco(60, 1, { logradouro: 'Rua Z' }), endereco(61, 1, { tipo: 'principal', principal: true, logradouro: 'Av. Principal' }), endereco(62, 1, { ativo: false }), endereco(63, 2)] },
      HOJE,
    );
    expect(ficha.enderecos.map((e) => [e.id, e.padrao])).toEqual([[id(61), true], [id(60), false]]);
    expect(ficha.endereco_padrao_id).toBe(id(61));
    expect(ficha.enderecos[0]?.resumo).toBe('Av. Principal, 61 - Centro - Manaus/AM - CEP 69000-000');
  });

  it('RN-VEN-17: cliente sem endereço (ou linha antiga sem a lista) não quebra a ficha e não tem padrão', () => {
    const ficha = montarCliente360Local(l, HOJE);
    expect(ficha.enderecos).toEqual([]);
    expect(ficha.endereco_padrao_id).toBeNull();
  });

  it('RN-VEN-17: sem principal, o padrão é o primeiro endereço de entrega ativo; cobrança aparece mas nunca é padrão', () => {
    const ficha = montarCliente360Local({ ...l, enderecos: [endereco(70, 1, { tipo: 'cobranca', logradouro: 'Rua A Cobrança' }), endereco(71, 1, { logradouro: 'Rua B' })] }, HOJE);
    expect(ficha.endereco_padrao_id).toBe(id(71));
    expect(ficha.enderecos.map((e) => e.tipo)).toEqual(['entrega', 'cobranca']);
  });

  it('RN-VEN-17: linha removida no servidor (deleted_at) some da ficha', () => {
    const ficha = montarCliente360Local({ ...l, enderecos: [endereco(80, 1, { deleted_at: '2026-10-31T09:00:00Z' })] }, HOJE);
    expect(ficha.enderecos).toEqual([]);
  });
});

describe('modo avião: abrir a ficha do cliente depois de um sync (critério 2 da T-0017)', () => {
  const linhas: Record<string, LinhaSync[]> = {
    cliente: [cliente(1, 'Auto Peças Um')],
    carteira: [],
    cliente_contato: [contato(10, 1, 'Marcos Compras', true, '9232220001', '92999990001')],
    cliente_financeiro: [financeiro(1, 5_000_000, 1_000_000)],
    titulo: [titulo(21, 1, '2026-10-21', 500_000), titulo(22, 1, '2026-11-20', 500_000)],
    historico_compra: [compras(31, 1, '2026-10', 800_000, 2, '2026-10-20')],
    cliente_endereco: [endereco(60, 1, { tipo: 'principal', principal: true, descricao: 'Matriz' }), endereco(61, 1, { descricao: 'Depósito' })],
  };

  async function sincronizarOnline() {
    const registro = criarRegistroSync([manifest]);
    for (const e of entidadesCliente) registro.registrar(e);
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core'], linhas });
    const armazenamento = criarArmazenamentoEmMemoria();
    const abrir = () => criarMotorSync({ registro, armazenamento, transporte: servidor, agora: () => new Date('2026-10-31T14:00:00Z'), online: () => servidor.online });
    const motor = abrir();
    await motor.aplicarModulosAtivos(['core']);
    expect(await motor.sincronizar()).toBe(true);
    return { servidor, abrir };
  }

  it('RF-CORE-04: com o transporte desligado (e o app reaberto), a ficha abre com financeiro, títulos e histórico', async () => {
    const { servidor, abrir } = await sincronizarOnline();
    servidor.online = false;
    const chamadasAntes = { ...servidor.chamadas };
    const reaberto = abrir();
    await reaberto.carregar();

    const [cli] = await reaberto.linhas<ClienteSync & LinhaSync>('cliente');
    const por = async <L extends LinhaSync & { cliente_id: string }>(e: string) => (await reaberto.linhas<L>(e)).filter((x) => x.cliente_id === cli!.id);
    const ficha = montarCliente360Local(
      {
        cliente: cli!,
        contatos: await por<ClienteContatoSync & LinhaSync>('cliente_contato'),
        financeiro: (await por<ClienteFinanceiroSync & LinhaSync>('cliente_financeiro'))[0] ?? null,
        titulos: await por<TituloSync & LinhaSync>('titulo'),
        historico: await por<HistoricoCompraSync & LinhaSync>('historico_compra'),
        enderecos: await por<ClienteEnderecoSync & LinhaSync>('cliente_endereco'),
      },
      HOJE,
    );
    expect(ficha.enderecos.map((e) => [e.descricao, e.padrao])).toEqual([['Matriz', true], ['Depósito', false]]);
    expect(ficha.resumo_financeiro).toMatchObject({ limite_cents: 5_000_000, credito_disponivel_cents: 4_000_000, vencidos_qtd: 1, a_vencer_qtd: 1 });
    expect(ficha.historico).toHaveLength(1);
    expect(ficha.ligar).toBe('tel:+559232220001');
    expect(ficha.whatsapp).toBe('https://wa.me/5592999990001');
    // nenhuma chamada de rede foi necessária para abrir a ficha
    expect(servidor.chamadas).toEqual(chamadasAntes);
  });

  it('RN-CORE-04: sincronizar sem sinal não apaga o que já está no aparelho', async () => {
    const { servidor, abrir } = await sincronizarOnline();
    servidor.online = false;
    const motor = abrir();
    await motor.carregar();
    expect(await motor.sincronizar()).toBe(false);
    expect((await motor.linhas('titulo')).length).toBe(2);
  });
});

describe('RN-CORE-16/17: etiqueta de cadastro incompleto na lista local', () => {
  it('RN-CORE-16: cliente sem CEP vem marcado; completo e linha antiga (sem o campo) não', () => {
    const lista = listarClientesLocais(
      { clientes: [cliente(1, 'Sem Cep', { cadastro_incompleto: true, cadastro_campos_faltantes: ['cep'] }), cliente(2, 'Completo', { cadastro_incompleto: false }), cliente(3, 'Antigo')], financeiros: [], titulos: [], historico: [] },
      HOJE,
    );
    expect(Object.fromEntries(lista.map((i) => [i.nome_fantasia, i.cadastro_incompleto]))).toEqual({ 'Sem Cep': true, Completo: false, Antigo: false });
  });
});
