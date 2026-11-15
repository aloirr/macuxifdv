/**
 * Catálogo onda 1 (ADR 0054, solução 5: busca e ficha pela API enquanto o catálogo carrega) e estoque por filial só nas filiais de
 * VENDA do usuário (RN-CAT-05 revista, RN-CORE-39, R-20261115-104500 item 4). Complementa
 * tests/modulos/catalogo-v2-campo-r20261115.test.ts (cartão, códigos, copiar e filtro padrão): aqui ficam a folha "Estoque por
 * filial" e o filtro de filial com valor, da linha `usuario` do sync até a tela.
 */
import { describe, expect, it, vi } from 'vitest';
import { existe, importar } from '../apoio/v1013';

const CARGA_ONLINE = 'modules/catalogo/app/lib/carga-online.ts';
const FOLHA = 'modules/catalogo/app/lib/estoque-folha.ts';
const COM_ONDA1 = existe(CARGA_ONLINE);
const COM_FOLHA = existe(FOLHA);

type Get = (caminho: string, query?: Record<string, unknown>) => Promise<unknown>;
interface Porta {
  pendentes(): readonly string[] | undefined;
  online(): boolean;
  get: Get;
}
interface CargaOnline {
  TEXTO_CATALOGO_CARREGANDO: string;
  catalogoPendente(p: readonly string[] | undefined): boolean;
}
interface ConsultasOnline {
  portaDaCarga(consulta: string, p: Porta | null): Porta | null;
  buscaProdutosOnline(p: Porta, e: { q: string; limite: number; cliente_id?: string | null }): Promise<{ itens: { produto_id: string }[]; total: number }>;
}

describe('ADR 0054 solução 5 — busca e ficha online enquanto o catálogo carrega', () => {
  if (!COM_ONDA1) {
    it('antes do PR do modulo-catalogo: a busca do aparelho só responde com as linhas locais', () => {
      expect(existe('modules/catalogo/app/lib/consultas-online.ts')).toBe(false);
    });
    return;
  }
  const porta = (pendentes: string[], online: boolean, get: Get = vi.fn()): Porta => ({ pendentes: () => pendentes, online: () => online, get });

  it('o que o motor deixou pendente decide: catálogo e preços pendentes = API; só clientes pendentes = aparelho', async () => {
    const { catalogoPendente } = await importar<CargaOnline>(CARGA_ONLINE);
    const { portaDaCarga } = await importar<ConsultasOnline>('modules/catalogo/app/lib/consultas-online.ts');
    expect(catalogoPendente(['produto', 'tabela_preco'])).toBe(true);
    expect(catalogoPendente(['cliente', 'pedido'])).toBe(false);
    expect(portaDaCarga('catalogo.busca_produtos@1', porta(['cliente'], true))).toBeNull();
    expect(portaDaCarga('catalogo.busca_produtos@1', porta([], true))).toBeNull();
    const p = porta(['produto'], true);
    expect(portaDaCarga('catalogo.busca_produtos@1', p)).toBe(p);
  });

  it('sem sinal com o catálogo pendente: consulta indisponível com o texto de carregando (nunca "sem resultado")', async () => {
    const { TEXTO_CATALOGO_CARREGANDO } = await importar<CargaOnline>(CARGA_ONLINE);
    const { portaDaCarga } = await importar<ConsultasOnline>('modules/catalogo/app/lib/consultas-online.ts');
    expect(() => portaDaCarga('catalogo.busca_produtos@1', porta(['produto'], false))).toThrow(TEXTO_CATALOGO_CARREGANDO);
  });

  it('busca online com cliente: vai à API com o cliente e, no pedido, só fica o vendável (RN-CAT-06)', async () => {
    const { buscaProdutosOnline } = await importar<ConsultasOnline>('modules/catalogo/app/lib/consultas-online.ts');
    const get = vi.fn(async () => ({
      items: [
        { id: 'a', score: 2, price: { sellable: true } },
        { id: 'b', score: 1, price: { sellable: false } },
      ],
      total: 2,
      next_offset: null,
    }));
    const r = await buscaProdutosOnline(porta(['produto'], true, get), { q: 'filtro', limite: 20, cliente_id: 'c1' });
    expect(get).toHaveBeenCalledWith(expect.stringContaining('busca'), expect.objectContaining({ q: 'filtro', customer_id: 'c1' }));
    expect(r.itens.map((i) => i.produto_id)).toEqual(['a']);
    expect(r.total).toBe(1);
  });
});

describe('RN-CAT-05 revista / RN-CORE-39 — folha "Estoque por filial" e filtro só com as filiais de venda', () => {
  if (!COM_FOLHA) {
    it('antes do PR do modulo-catalogo (v8): sem a folha nem o filtro por filiais de venda', () => {
      expect(existe('modules/catalogo/domain/estoque-campo.ts')).toBe(false);
    });
    return;
  }
  const BVB = 'f-bvb';
  const MAO = 'f-mao';
  const PVH = 'f-pvh';
  const STM = 'f-stm';
  const NOMES: Record<string, string> = { [BVB]: 'Boa Vista', [MAO]: 'Manaus', [PVH]: 'Porto Velho', [STM]: 'Santarém' };
  const linhaUsuario = { id: 'u1', filial_cadastro_id: BVB, filial_venda_ids: [BVB, MAO, PVH], sem_filial: false };
  const saldo = (id: string, quantity: number) => ({ branch_id: id, branch_name: NOMES[id]!, quantity, updated_at: '2026-11-15T10:12:00Z' });
  const SALDOS = [saldo(BVB, 0), saldo(MAO, 12), saldo(PVH, 5), saldo(STM, 40)];
  const PARAMETROS = { estoque_baixo_ate: 10, estoque_mostrar_quantidade: true, estoque_defasado_horas: 24 };

  async function folha(saldos = SALDOS) {
    const { lerFiliaisDeVendaDaLinha } = await importar<{ lerFiliaisDeVendaDaLinha(l: unknown): { filiaisVenda: readonly string[]; semFilial: boolean } | null }>('modules/catalogo/app/lib/filiais-usuario.ts');
    const dominio = await importar<{
      filiaisDoEstoque(u: object, e: { filialDoCliente: string | null; filtro: string | null }): readonly string[];
      filiaisDaFolha(u: object): readonly string[];
    }>('modules/catalogo/domain/estoque-campo.ts');
    const { estoqueVisivel } = await importar<{ estoqueVisivel(id: string, s: unknown[], o: object): Record<string, unknown> & { quantity: number | null } }>('modules/catalogo/domain/estoque.ts');
    const lib = await importar<{
      dadosDaFolha(e: object): { linhas: { id: string; nome: string; valor: string }[] };
      opcoesDoFiltroFilial(e: object): { valor: string; rotulo: string }[];
    }>(FOLHA);
    const doUsuario = lerFiliaisDeVendaDaLinha(linhaUsuario)!;
    const usuario = { perfil: 'supervisor', filiaisVenda: doUsuario.filiaisVenda, semFilial: doUsuario.semFilial };
    const availability = estoqueVisivel('p1', saldos, {
      filiais: dominio.filiaisDoEstoque(usuario, { filialDoCliente: null, filtro: null }),
      filiaisFolha: dominio.filiaisDaFolha(usuario),
      agora: '2026-11-15T15:00:00Z',
      parametros: PARAMETROS,
    });
    const dados = lib.dadosDaFolha({ codigo: 'PAF.1434', availability, cargaEm: '2026-11-15T10:12:00Z', proprias: doUsuario.filiaisVenda, agora: '2026-11-15T15:00:00Z', fuso: 'America/Manaus' });
    const filtro = lib.opcoesDoFiltroFilial({ proprias: doUsuario.filiaisVenda, filiais: Object.entries(NOMES).map(([id, nome]) => ({ id, nome })) });
    return { availability, linhas: dados.linhas, filtro };
  }

  it('"Estoque: N" soma só as de venda (0 + 12 + 5 = 17); Santarém (40, fora da lista) não entra', async () => {
    const { availability } = await folha();
    expect(availability.quantity).toBe(17);
  });

  it('folha: uma linha por filial de venda com o valor dela; a filial fora da lista não aparece', async () => {
    const { linhas } = await folha();
    expect(linhas.map((l) => [l.nome, l.valor])).toEqual([
      ['Boa Vista', '0'],
      ['Manaus', '12'],
      ['Porto Velho', '5'],
    ]);
    expect(linhas.some((l) => l.id === STM)).toBe(false);
  });

  it('filtro: "Suas filiais (3)" e as três de venda; Santarém não é opção', async () => {
    const { filtro } = await folha();
    expect(filtro.map((o) => o.rotulo)).toEqual(['Suas filiais (3)', 'Boa Vista', 'Manaus', 'Porto Velho']);
  });

  it('a filial de cadastro está sempre na folha, mesmo sem linha de saldo nela (sem registro = 0, RN-CORE-39)', async () => {
    const { linhas } = await folha(SALDOS.filter((s) => s.branch_id !== BVB));
    expect(linhas.find((l) => l.id === BVB)).toMatchObject({ nome: 'Boa Vista', valor: '0' });
  });
});
