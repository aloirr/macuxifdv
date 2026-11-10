/**
 * T-0149 (filial, RN-CORE-39) e T-0147 (fotos do PDV, RN-CORE-38): casos de critério ENTRE módulos, sem banco (local e CI).
 * Os testes de cada dono cobrem a sua função; aqui a cadeia: Core (filial efetiva) → Catálogo no aparelho (preço e estoque) →
 * Vendedor (retrato da filial no aprovado@1) → Integração (payload do ERP e versão do Conector); e, nas fotos, a matriz
 * perfil × tipo sensível contra o texto da RN e o que o pull e a API entregam ao vendedor. Os .db.test.ts ficam no CI.
 * ORÁCULOS escritos do texto das RNs (doc 03, 10/11/2026), nunca chamando a função testada para obter o esperado.
 * Matriz: docs/testes/T-0149-T-0147.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { perfilLeArquivo } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { manifest as manifestCore } from '../../modules/core/manifest';
import { ClienteFotoSyncSchema } from '../../modules/core/contracts';
import { filialEfetiva, PERFIS_DOC_SENSIVEL, perfisDeLeitura, podeAbrirFoto, fachadaDoPdv, podeEnviarFoto, resumoFotos, type TipoFotoLike } from '../../modules/core/domain';
import { filialDoClienteLocal } from '../../modules/catalogo/domain/preco-filial';
import { esquecerMemoriaLocal, vitrineLocal, type LeitorLocal } from '../../modules/catalogo/app/lib/local';
import { filialParaEvento } from '../../modules/vendedor/api/aprovado-erp';
import { PedidoAprovadoEvento } from '../../modules/vendedor/contracts/eventos';
import { PedidoAprovadoParaFila } from '../../modules/integracao/contracts/pedido';
import { montarPedidoParaErp } from '../../modules/integracao/domain/pedido-fila';
import { exigeConector } from '../../modules/integracao/domain/pedido-versao';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const id = (n: number) => `0f170000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const QUANDO = '2026-11-10T13:00:00.000Z';
const linha = (lid: string, o: Record<string, unknown>): LinhaSync => ({ id: lid, updated_at: QUANDO, deleted_at: null, external_id: null, ...o }) as LinhaSync;

// ---------- T-0149: duas filiais, um cliente em cada (e um sem filial) ----------
const F_MAO = id(1); // padrão
const F_BVB = id(2);
const D_MAO = id(11);
const D_BVB = id(12);
const TAB = id(21);
const P_CAF = id(31); // tem preço e saldo nas duas filiais
const P_ACU = id(32); // preço nas duas; saldo só em Manaus
const C_MAO = id(41);
const C_BVB = id(42);
const C_SEM = id(43); // sem filial informada → padrão

const FILIAIS = [
  { id: F_MAO, codigo: '0001', nome: 'Manaus', cidade: 'Manaus', uf: 'AM', padrao: true, ativo: true },
  { id: F_BVB, codigo: '0002', nome: 'Boa Vista', cidade: 'Boa Vista', uf: 'RR', padrao: false, ativo: true },
];
/** Oráculo (RN-CORE-39, "Estoque" e "Preço" + premissas): preço da tabela na filial do cliente; estoque só da filial dele; sem registro = 0. */
const ESPERADO: Record<string, { filial: string; caf: { preco: number; estoque: number }; acu: { preco: number; estoque: number } }> = {
  [C_MAO]: { filial: 'Manaus', caf: { preco: 1_890, estoque: 50 }, acu: { preco: 1_790, estoque: 30 } },
  [C_BVB]: { filial: 'Boa Vista', caf: { preco: 1_990, estoque: 7 }, acu: { preco: 1_850, estoque: 0 } },
  [C_SEM]: { filial: 'Manaus', caf: { preco: 1_890, estoque: 50 }, acu: { preco: 1_790, estoque: 30 } },
};

function linhasFilial(): Record<string, LinhaSync[]> {
  return {
    produto: [
      linha(P_CAF, { sku: 'CAF-500', ean: null, nome: 'Café 500 g', marca: 'Boto', categoria: 'Mercearia', unidade: 'UN', ativo: true }),
      linha(P_ACU, { sku: 'ACU-1K', ean: null, nome: 'Açúcar 1 kg', marca: 'Boto', categoria: 'Mercearia', unidade: 'UN', ativo: true }),
    ],
    filial: FILIAIS.map((f) => linha(f.id, f)),
    cliente: [linha(C_MAO, { filial_id: F_MAO }), linha(C_BVB, { filial_id: F_BVB }), linha(C_SEM, { filial_id: null })],
    tabela_preco: [linha(TAB, { codigo: 'ATACADO', nome: 'Atacado', ativo: true })],
    tabela_preco_item: [
      linha(id(51), { tabela_preco_id: TAB, produto_id: P_CAF, preco_cents: 1_890, vigencia_inicio: null, vigencia_fim: null, filial_id: F_MAO }),
      linha(id(52), { tabela_preco_id: TAB, produto_id: P_CAF, preco_cents: 1_990, vigencia_inicio: null, vigencia_fim: null, filial_id: F_BVB }),
      linha(id(53), { tabela_preco_id: TAB, produto_id: P_ACU, preco_cents: 1_790, vigencia_inicio: null, vigencia_fim: null, filial_id: F_MAO }),
      linha(id(54), { tabela_preco_id: TAB, produto_id: P_ACU, preco_cents: 1_850, vigencia_inicio: null, vigencia_fim: null, filial_id: F_BVB }),
    ],
    cliente_tabela_preco: [C_MAO, C_BVB, C_SEM].map((c, k) => linha(id(61 + k), { cliente_id: c, tabela_preco_id: TAB })),
    deposito: [linha(D_MAO, { codigo: 'CD-MAO', nome: 'CD Manaus', ativo: true, filial_id: F_MAO }), linha(D_BVB, { codigo: 'CD-BVB', nome: 'CD Boa Vista', ativo: true, filial_id: F_BVB })],
    estoque_saldo: [
      linha(id(71), { produto_id: P_CAF, deposito_id: D_MAO, quantidade: 50, atualizado_em: QUANDO }),
      linha(id(72), { produto_id: P_CAF, deposito_id: D_BVB, quantidade: 7, atualizado_em: QUANDO }),
      linha(id(73), { produto_id: P_ACU, deposito_id: D_MAO, quantidade: 30, atualizado_em: QUANDO }),
    ],
  };
}
const leitor = (l = linhasFilial()): LeitorLocal => ({ linhas: async <L extends LinhaSync>(e: string) => (l[e] ?? []) as L[] });

describe('T-0149 critério 1 — um cliente de cada filial vê o preço e o estoque da sua, no aparelho e offline (RN-CORE-39)', () => {
  beforeEach(() => esquecerMemoriaLocal());

  for (const [cliente, nome] of [[C_MAO, 'Manaus'], [C_BVB, 'Boa Vista'], [C_SEM, 'sem filial → padrão']] as const) {
    it(`cliente de ${nome}: preço da tabela na filial dele e estoque só dela (vitrine do Novo pedido e da busca)`, async () => {
      const r = await vitrineLocal(leitor(), { perfil: 'vendedor', parametros: {}, agora: QUANDO, clienteId: cliente, limit: 10, offset: 0 });
      const e = ESPERADO[cliente]!;
      const item = (pid: string) => r.items.find((i) => i.id === pid)!;
      for (const [pid, esp] of [[P_CAF, e.caf], [P_ACU, e.acu]] as const) {
        expect(item(pid).price, `${nome} ${pid}`).toMatchObject({ sellable: true, price_cents: esp.preco });
        expect(item(pid).availability?.quantity, `${nome} ${pid}`).toBe(esp.estoque);
        // rótulo × valor: o saldo mostrado é o da filial do cliente, com o nome dela; nunca o somado das duas
        expect(item(pid).availability?.by_branch.map((b) => b.branch_name), `${nome} ${pid}`).toEqual(esp.estoque === 0 ? expect.any(Array) : [e.filial]);
      }
      // a premissa "sem registro de estoque na filial = 0": o açúcar de Boa Vista nunca mostra os 30 de Manaus
      if (cliente === C_BVB) expect(item(P_ACU).availability?.band).toBe('sem_estoque');
    });
  }

  it('Core e Catálogo decidem a mesma filial efetiva (própria viva e ativa; nula, inativa ou apagada → padrão)', () => {
    const inativa = { id: id(3), codigo: '0003', nome: 'Santarém', cidade: 'Santarém', uf: 'PA', padrao: false, ativo: false };
    const vivas = [...FILIAIS, inativa];
    for (const c of [F_BVB, F_MAO, null, inativa.id, id(999)]) {
      const core = filialEfetiva(c, vivas).id;
      const cat = filialDoClienteLocal(c, vivas)!.filialCliente;
      const oraculo = c === F_BVB ? F_BVB : F_MAO;
      expect([core, cat], String(c)).toEqual([oraculo, oraculo]);
    }
  });
});

describe('T-0149 critério 2 — o pedido leva a filial até o ERP (Vendedor → Hub → Conector)', () => {
  const T = '2026-11-10T14:00:00.000Z';
  const item = { sequencia: 1, produto_external_id: 'CAF-500', quantidade: 2, preco_unitario_cents: 1_990, desconto_cents: 0, total_cents: 3_980 };
  const aprovado = (filial: unknown) => ({ pedido_uuid: '7a1f0000-0000-4000-8000-000000000001', cliente_external_id: 'C-BVB', vendedor_external_id: 'V1', criado_em: T, aprovado_em: T, itens: [item], total_cents: 3_980, ...(filial === undefined ? {} : { filial }) });

  it('retrato da filial do cliente de Boa Vista: o bloco do aprovado@1 (Vendedor) passa no contrato do Hub e chega ao payload do ERP; exige o Conector 1.4.0', () => {
    const retrato = { id: F_BVB, codigo: '0002', nome: 'Boa Vista', external_id: 'FIL-BV', padrao: false, cidade: 'Boa Vista', uf: 'RR' };
    const bloco = filialParaEvento(retrato);
    expect(PedidoAprovadoEvento.shape.filial.parse(bloco)).toEqual({ codigo: '0002', external_id: 'FIL-BV', nome: 'Boa Vista', padrao: false });
    const m = montarPedidoParaErp(PedidoAprovadoParaFila.parse(aprovado(bloco)), []);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.pedido.filial).toMatchObject({ codigo: '0002', external_id: 'FIL-BV' });
      expect(exigeConector(m.pedido)).toBe('1.4.0');
    }
  });

  it('cliente da filial padrão (Manaus): leva a filial e vai a qualquer Conector; pedido anterior (sem retrato) segue sem a chave', () => {
    const m = montarPedidoParaErp(PedidoAprovadoParaFila.parse(aprovado(filialParaEvento({ codigo: '0001', nome: 'Manaus', external_id: null, padrao: true }))), []);
    expect(m.ok && m.pedido.filial?.codigo).toBe('0001');
    expect(m.ok && exigeConector(m.pedido)).toBeNull();
    const antigo = montarPedidoParaErp(PedidoAprovadoParaFila.parse(aprovado(filialParaEvento(null))), []);
    expect(antigo.ok && 'filial' in antigo.pedido).toBe(false);
  });

  it.todo('v1.0.4 (decisão do gerente R-20261110-111746): o recebimento grava a filial do cliente NO RECEBIMENTO no pedido e o detalhe e os PDFs a mostram (ponta a ponta com o Conector 1.4.0)');
});

// ---------- T-0147: fotos do PDV ----------
/** Oráculo, texto da RN-CORE-38 ("Acesso"): os sensíveis abrem só para estes perfis (o gerente entrou em 10/11, R-20261110-085951). */
const LEITURA_SENSIVEL_RN = ['admin', 'analista', 'gerente', 'supervisor'];
const TODOS = manifestCore.acoes['cliente_foto.ver']!.perfis;
const tipo = (o: Partial<TipoFotoLike> & { id: string; nome: string }): TipoFotoLike => ({ obrigatorio: false, sensivel: false, fachada: false, ordem: 0, ativo: true, ...o });
const FACHADA = tipo({ id: id(81), nome: 'Fachada', fachada: true, obrigatorio: true });
const CNH = tipo({ id: id(82), nome: 'CNH do sócio', sensivel: true, obrigatorio: true, ordem: 1 });
const CONTRATO = tipo({ id: id(83), nome: 'Contrato social', sensivel: true, ordem: 2 });
const INTERIOR = tipo({ id: id(84), nome: 'Interior da loja', ordem: 3 }); // não sensível e não fachada

describe('T-0147 critério 4/5 — quem abre o quê (RN-CORE-38)', () => {
  it('a lista de perfis de leitura dos sensíveis é a da RN (fonte única do Core) e o SDK só deixa ler quem está nela', () => {
    expect([...PERFIS_DOC_SENSIVEL].sort()).toEqual([...LEITURA_SENSIVEL_RN].sort());
    expect(perfisDeLeitura(CNH)).toEqual(PERFIS_DOC_SENSIVEL);
    for (const perfil of TODOS) {
      const deve = LEITURA_SENSIVEL_RN.includes(perfil);
      expect(podeAbrirFoto(perfil, CNH), `domínio ${perfil}`).toBe(deve);
      expect(perfilLeArquivo(perfisDeLeitura(CNH), { perfil: perfil as never }), `GET /v1/arquivos ${perfil}`).toBe(deve);
    }
    // vendedor, promotor e assistente veem o resumo (cliente_foto.ver), mas não abrem o sensível
    for (const p of ['vendedor', 'promotor', 'assistente']) expect(TODOS).toContain(p);
  });

  it('a fachada abre para todos os perfis do resumo (a carteira vale à parte) e "Ver foto do PDV" só liga com ela enviada', () => {
    for (const perfil of TODOS) expect(podeAbrirFoto(perfil, FACHADA), perfil).toBe(true);
    expect(perfisDeLeitura(FACHADA)).toBeNull();
    const tipos = [FACHADA, CNH, CONTRATO, INTERIOR];
    const viva = { foto_tipo_id: FACHADA.id, arquivo_id: id(95) };
    expect(fachadaDoPdv(tipos, [{ foto_tipo_id: CNH.id, arquivo_id: id(96) }, { foto_tipo_id: INTERIOR.id, arquivo_id: id(97) }])).toBeNull();
    expect(fachadaDoPdv(tipos, [{ ...viva, deleted_at: QUANDO }])).toBeNull();
    expect(fachadaDoPdv(tipos, [{ foto_tipo_id: FACHADA.id, arquivo_id: null }])).toBeNull(); // registro sem arquivo enviado
    expect(fachadaDoPdv([{ ...FACHADA, ativo: false }, CNH], [viva])).toBeNull();
    expect(fachadaDoPdv(tipos, [{ foto_tipo_id: CNH.id, arquivo_id: id(96) }, viva])).toEqual(viva);
  });

  it('o vendedor só recebe o arquivo_id da fachada: o pull troca os demais por nulo pelo tipo, e o resumo da API só preenche o que o perfil abre', () => {
    const sync = ler('modules/core/api/sync.ts');
    expect(sync).toContain('case when t.fachada then f.arquivo_id else null end as arquivo_id');
    expect(ClienteFotoSyncSchema.safeParse({ id: id(91), updated_at: QUANDO, deleted_at: null, external_id: null, cliente_id: C_MAO, foto_tipo_id: CNH.id, arquivo_id: null, origem: 'galeria', tirada_em: QUANDO }).success).toBe(true);
    const api = ler('modules/core/api/fotos-pdv.ts');
    expect(api).toMatch(/arquivo_id: i\.situacao === 'tem' && podeAbrirFoto\(ctx\.usuario\.perfil, \{ fachada: fachada\.get\(i\.tipo_id\) \?\? false \}\)/);
    // o GET do arquivo confere a lista do arquivo (ADR 0041) e responde 404, sem revelar que existe
    const get = ler('apps/api/src/arquivos.ts');
    expect(get).toContain('if (!perfilLeArquivo(linha.perfis_leitura, u)) throw naoEncontrado();');
  });

  it('resumo tem/falta: o vendedor vê que o sensível existe ("tem") sem abri-lo; envia só o que falta, admin/analista/supervisor substituem', () => {
    const r = resumoFotos([INTERIOR, CONTRATO, FACHADA, CNH], [{ foto_tipo_id: FACHADA.id }, { foto_tipo_id: CNH.id }]);
    expect(r.itens.map((i) => [i.nome, i.situacao])).toEqual([['Fachada', 'tem'], ['CNH do sócio', 'tem'], ['Contrato social', 'falta'], ['Interior da loja', 'falta']]);
    expect(r.faltam_obrigatorias).toBe(0);
    expect(podeEnviarFoto('vendedor', true).ok).toBe(false);
    expect(podeEnviarFoto('vendedor', false).ok).toBe(true);
    for (const p of ['admin', 'analista', 'supervisor']) expect(podeEnviarFoto(p, true).ok, p).toBe(true);
  });

  it('D-1 corrigido (RN-CORE-38, R-20261110-123325): vendedor e promotor só abrem a fachada; tipo NÃO sensível que não é a fachada ("Interior da loja") aparece como tem/falta e não abre', () => {
    for (const p of ['vendedor', 'promotor', 'assistente']) {
      expect(podeAbrirFoto(p, INTERIOR), p).toBe(false);
      expect(podeAbrirFoto(p, FACHADA), p).toBe(true);
      expect(perfilLeArquivo(perfisDeLeitura(INTERIOR), { perfil: p as never }), `GET /v1/arquivos ${p}`).toBe(false);
    }
    for (const p of LEITURA_SENSIVEL_RN) expect(podeAbrirFoto(p, INTERIOR), p).toBe(true);
  });
});
