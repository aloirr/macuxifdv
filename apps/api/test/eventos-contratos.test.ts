/**
 * T-0024 — payload dos eventos no `contracts` do dono e leitura tolerante no consumidor (desenho docs/desenho/T-0024.md).
 *
 * 1. Publicação: todo evento do `publica` de cada manifesto tem `DefinicaoEvento` exportada no `contracts` do dono, e
 *    nenhum `contracts` exporta definição de evento de outro módulo (cópia de payload).
 * 2. Consumo: todo consumidor registrado na API (`consumidores` do `definirModuloApi`) valida com o schema OFICIAL do
 *    dono, lido com `eventoTolerante` (o próprio módulo pode usar o oficial direto). Exceção: o Gestor usa `z.unknown()`
 *    no despachante e valida no domain (evento ruim vira aviso e não trava a fila), por isso ele confere o mapa dele.
 *
 * Catraca: o que já estava fora do padrão em 05/11 está em PENDENTES e não reprova; problema NOVO reprova. Quando um
 * dono resolve um pendente, o teste avisa no console e o engenheiro-software tira a linha na revisão (o dono não
 * precisa editar este arquivo).
 */
import * as catalogo from '@macuxi/catalogo/contracts';
import * as core from '@macuxi/core/contracts';
import * as gestor from '@macuxi/gestor/contracts';
import * as integracao from '@macuxi/integracao/contracts';
import * as pesquisa from '@macuxi/pesquisa/contracts';
import { conferirEventosPublicados, definicoesExportadas, schemaOficialDe, type ModuloId } from '@macuxi/platform-sdk';
import * as promotor from '@macuxi/promotor/contracts';
import * as treinamento from '@macuxi/treinamento/contracts';
import * as vendedor from '@macuxi/vendedor/contracts';
import { describe, expect, it } from 'vitest';
import { MODULOS_API } from '../src/modulos';

const CONTRACTS: Record<string, Record<string, unknown>> = { core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao };

/** Consumidores com schema aberto (`z.unknown()`) que validam no domain com o contrato do dono. */
const CONSUMO_ABERTO: readonly ModuloId[] = ['gestor'];

const PENDENTES_PUBLICACAO = new Set<string>([
  // catalogo: declarados em `publica`, ainda sem schema (modulo-catalogo)
  'catalogo.produto.visualizado@1: publicado por catalogo sem DefinicaoEvento exportada no contracts',
  'catalogo.busca.realizada@1: publicado por catalogo sem DefinicaoEvento exportada no contracts',
  // integracao: schemas em contracts/eventos.ts, definições em api/eventos.ts (modulo-integracao move para contracts)
  ...[
    'cliente', 'produto', 'preco', 'estoque', 'vendedor', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora',
  ].map((e) => `integracao.${e}.atualizado@1: publicado por integracao sem DefinicaoEvento exportada no contracts`),
  ...['pedido.retorno_erp', 'lote.concluido', 'reconciliacao.divergente', 'lote.recebido'].map(
    (e) => `integracao.${e}@1: publicado por integracao sem DefinicaoEvento exportada no contracts`,
  ),
  // vendedor: espelho do retorno do ERP em contracts/pre-venda.ts (modulo-vendedor troca pelo import do dono)
  'integracao.pedido.retorno_erp@1: contracts de vendedor exporta definição de evento de integracao (importe do contracts do dono)',
]);

/** `<consumidor> <- <evento>` ainda com cópia do payload (cada consumidor troca pelo `eventoTolerante(EVENTO_X)` do dono). */
const PENDENTES_CONSUMO = new Set<string>([
  'core <- vendedor.pedido.status_alterado@1',
  'core <- vendedor.pedido.aprovacao_solicitada@1',
  ...['cliente', 'produto', 'vendedor', 'titulo', 'nota', 'rota', 'produto_unidade', 'cliente_endereco'].map((e) => `core <- integracao.${e}.atualizado@1`),
  ...['estoque', 'preco', 'catalogo_no', 'produto'].map((e) => `catalogo <- integracao.${e}.atualizado@1`),
  'vendedor <- integracao.pedido.retorno_erp@1',
  'integracao <- vendedor.pedido.aprovado@1',
  'integracao <- vendedor.pedido.status_alterado@1',
  'integracao <- integracao.lote.recebido@1',
]);

function problemasDePublicacao(): string[] {
  return MODULOS_API.flatMap((m) => conferirEventosPublicados(m.manifesto, CONTRACTS[m.manifesto.id] ?? {}));
}

function problemasDeConsumo(): string[] {
  const r: string[] = [];
  for (const m of MODULOS_API) {
    for (const c of m.consumidores ?? []) {
      const chave = `${m.manifesto.id} <- ${c.evento.nome}`;
      const oficial = definicoesExportadas(CONTRACTS[c.evento.modulo] ?? {}).get(c.evento.nome);
      const typeName = (c.evento.schema._def as { typeName?: string }).typeName;
      if (CONSUMO_ABERTO.includes(m.manifesto.id) && typeName === 'ZodUnknown') continue;
      if (!oficial) {
        r.push(chave);
        continue;
      }
      const proprio = c.evento.modulo === m.manifesto.id;
      const derivado = schemaOficialDe(c.evento.schema) === oficial.schema;
      const tolerante = derivado && c.evento.schema !== oficial.schema;
      if (!(proprio ? derivado : tolerante)) r.push(chave);
    }
  }
  return r;
}

function catraca(achados: string[], pendentes: Set<string>, rotulo: string) {
  const novos = achados.filter((p) => !pendentes.has(p));
  const resolvidos = [...pendentes].filter((p) => !achados.includes(p));
  if (resolvidos.length) console.info(`[T-0024] ${rotulo}: pendentes resolvidos (tirar de PENDENTES):\n  ${resolvidos.join('\n  ')}`);
  expect(novos, `${rotulo}: problema novo fora do padrão da T-0024 (docs/desenho/T-0024.md)`).toEqual([]);
}

describe('T-0024: payload dos eventos no contracts do dono', () => {
  it('todo evento publicado tem DefinicaoEvento no contracts do dono e nenhum contracts copia evento alheio', () => {
    catraca(problemasDePublicacao(), PENDENTES_PUBLICACAO, 'publicação');
  });

  it('todo consumidor lê com o schema oficial do dono, de forma tolerante (eventoTolerante)', () => {
    catraca(problemasDeConsumo(), PENDENTES_CONSUMO, 'consumo');
  });

  it('todo evento consumido existe no publica do dono (nome e versão)', () => {
    const publicados = new Set(MODULOS_API.flatMap((m) => m.manifesto.publica));
    const orfaos = MODULOS_API.flatMap((m) => (m.consumidores ?? []).map((c) => c.evento.nome).filter((n) => !publicados.has(n)));
    expect(orfaos).toEqual([]);
  });
});
