/**
 * Trabalho `processar_foto_lote` (RN-CAT-14, T-0174, ADR 0054 §2/§3/§6): roda em fatias (até 20 s) no worker, disparado por
 * `catalogo.foto_lote.enfileirado@1`. O checkpoint é o próprio item (`situacao = 'pendente'` → final): a fatia seguinte, o
 * reinício do worker ou outro processo retomam de onde parou, e como `arquivo_id`/`midia_id` nascem na conferência, repetir um
 * item regrava as mesmas chaves e não duplica nada.
 *
 * 1. Conferência (lote `enfileirado`/`conferindo`): abre o ZIP (a plataforma recusa o lote inteiro por tamanho, quantidade,
 *    ZIP inválido…), confere o SHA-256 contra outros lotes vivos (`duplicado`) e cria um item por entrada considerada.
 * 2. Itens (lote `processando`): até 100 `pendente` por fatia; uma consulta ao Core (`core.produtos_por_sku@1`) com os códigos;
 *    cada item numa transação curta; bytes e miniatura gravados FORA da transação (T-0121).
 * 3. Fim: nenhum `pendente` → `concluido`, evento `catalogo.foto_lote.concluido@1` e descarte das partes do ZIP.
 * Log: só contagens e ids; nunca nome de arquivo nem código de produto.
 */
import { randomUUID } from 'node:crypto';
import {
  classificarEntradaZip,
  definirTrabalho,
  type ContextoTrabalho,
  type LimitesZip,
  type MotivoRecusaEntrada,
  type MotivoRecusaZip,
  type TipoImagem,
  type TransacaoTrabalho,
  type ZipAberto,
} from '@macuxi/platform-sdk';
import { CONSULTA_PRODUTOS_POR_SKU } from '@macuxi/core/contracts';
import { EVENTO_FOTO_LOTE_CONCLUIDO, EVENTO_FOTO_LOTE_ENFILEIRADO, TIPOS_FOTO_LOTE, type MotivoItem, type SituacaoItem } from '../contracts';
import { codigosParaConsulta, interpretarNome, limitesFotoLote, resolverItem, type InterpretacaoNome, type ProdutoParaCasar } from '../domain/fotos-lote';
import { totaisDosLotes, lerLote, type LinhaLote } from './fotos-lote';
import { definirFotosProduto } from './miniatura';
import { esquecerRetratoCatalogo } from './repositorio-postgres';

/** Itens por fatia e linhas por insert da conferência. */
export const ITENS_POR_FATIA = 100;
export const LINHAS_POR_INSERT = 500;
/** A consulta ao Core aceita até 500 códigos por chamada (`core.produtos_por_sku@1`). */
export const CODIGOS_POR_CONSULTA = 500;

const SITUACOES_FINAIS = ['concluido', 'recusado', 'falhou', 'duplicado'];

/** Último segmento do caminho dentro do ZIP (a plataforma já trocou `\` por `/` ao classificar; refaz por segurança). */
export function nomeBaseDoCaminho(caminho: string): string {
  const partes = caminho.replace(/\\/g, '/').split('/');
  return partes[partes.length - 1] ?? caminho;
}

interface ItemPendente {
  id: string;
  indice: number;
  caminho: string;
  arquivo_id: string;
  midia_id: string;
}

/** Item que sai da conferência. */
export interface ItemNovo {
  indice: number;
  caminho: string;
  situacao: 'pendente' | 'recusado';
  motivo: MotivoItem | null;
  codigo: string | null;
}

/** RN-CAT-14: transforma o diretório do ZIP nos itens do relatório (ignorados ficam de fora; recusados já nascem recusados). */
export function itensDaConferencia(entradas: ZipAberto['entradas'], limites: LimitesZip): ItemNovo[] {
  const itens: ItemNovo[] = [];
  for (const e of entradas) {
    const c = classificarEntradaZip(e, limites);
    if (c.acao === 'ignorar') continue;
    const caminho = e.caminho.slice(0, 1024);
    if (c.acao === 'recusar') {
      itens.push({ indice: e.indice, caminho, situacao: 'recusado', motivo: c.motivo satisfies MotivoRecusaEntrada, codigo: null });
      continue;
    }
    const nome = interpretarNome(c.nomeBase);
    if (!nome.ok) itens.push({ indice: e.indice, caminho, situacao: 'recusado', motivo: nome.motivo, codigo: null });
    else itens.push({ indice: e.indice, caminho, situacao: 'pendente', motivo: null, codigo: nome.interpretacoes[0]!.codigo });
  }
  return itens;
}

async function publicarConcluido(t: TransacaoTrabalho, ctx: ContextoTrabalho, lote: LinhaLote, situacao: 'concluido' | 'recusado' | 'falhou' | 'duplicado', extra: { motivo?: MotivoRecusaZip | null; duplicadoDe?: string | null } = {}): Promise<void> {
  const totais = (await totaisDosLotes(t.db, [lote.id])).get(lote.id)!;
  await t.publicar(
    EVENTO_FOTO_LOTE_CONCLUIDO,
    {
      lote_id: lote.id,
      enviado_por: lote.enviado_por,
      situacao,
      motivo: extra.motivo ?? null,
      duplicado_de: extra.duplicadoDe ?? null,
      totais: { ligado: totais.ligado, sem_produto: totais.sem_produto, ambiguo: totais.ambiguo, recusado: totais.recusado, repetido: totais.repetido },
      ocorrido_em: ctx.agora().toISOString(),
    },
    lote.id,
  );
}

/** Encerra o lote num estado final (só se ainda não estiver) e publica o fato; devolve se foi este processo que encerrou. */
async function encerrar(ctx: ContextoTrabalho, lote: LinhaLote, situacao: 'concluido' | 'recusado' | 'falhou' | 'duplicado', extra: { motivo?: MotivoRecusaZip | null; duplicadoDe?: string | null } = {}): Promise<boolean> {
  const mudou = await ctx.emTransacao(async (t) => {
    const r = await t.db.query(
      `update catalogo.foto_lote set situacao = $2, motivo = $3, duplicado_de = $4, concluido_em = now()
        where id = $1::uuid and situacao <> all($5::text[])`,
      [lote.id, situacao, extra.motivo ?? null, extra.duplicadoDe ?? null, SITUACOES_FINAIS],
    );
    if ((r.rowCount ?? 0) === 0) return false;
    await publicarConcluido(t, ctx, lote, situacao, extra);
    return true;
  });
  // depois do commit: o ZIP não fica guardado (o SHA fica no lote para a idempotência)
  if (mudou) await ctx.arquivos.descartar(lote.arquivo_id);
  return mudou;
}

async function conferir(ctx: ContextoTrabalho, lote: LinhaLote): Promise<'continua' | 'concluido'> {
  await ctx.emTransacao((t) => t.db.query(`update catalogo.foto_lote set situacao = 'conferindo', iniciado_em = coalesce(iniciado_em, now()) where id = $1::uuid and situacao = 'enfileirado'`, [lote.id]));
  const limites = limitesFotoLote(ctx.parametros());
  const aberto = await ctx.arquivos.abrirZip(lote.arquivo_id, limites);
  if (!aberto.ok) {
    await encerrar(ctx, lote, 'recusado', { motivo: aberto.motivo });
    return 'concluido';
  }
  const zip = aberto.zip;
  try {
    const outro = await ctx.emTransacao((t) =>
      t.db.query<{ id: string }>(
        `select id from catalogo.foto_lote where sha256 = $1 and id <> $2::uuid and deleted_at is null and situacao not in ('falhou', 'duplicado') limit 1`,
        [zip.sha256, lote.id],
      ),
    );
    const duplicadoDe = outro.rows[0]?.id;
    if (duplicadoDe) {
      await encerrar(ctx, lote, 'duplicado', { duplicadoDe });
      return 'concluido';
    }
    const itens = itensDaConferencia(zip.entradas, limites);
    await ctx.emTransacao(async (t) => {
      // sha256 e total primeiro: o único do SHA é a trava contra dois lotes iguais ao mesmo tempo
      await t.db.query(`update catalogo.foto_lote set sha256 = $2, total = $3 where id = $1::uuid`, [lote.id, zip.sha256, itens.length]);
      for (let i = 0; i < itens.length; i += LINHAS_POR_INSERT) {
        const f = itens.slice(i, i + LINHAS_POR_INSERT);
        // arquivo_id e midia_id nascem aqui: repetir a conferência (on conflict) não troca as chaves do item
        await t.db.query(
          `insert into catalogo.foto_lote_item (tenant_id, lote_id, indice, caminho, situacao, motivo, codigo, arquivo_id, midia_id, processado_em)
           select plataforma.tenant_atual(), $1::uuid, x.indice, x.caminho, x.situacao, x.motivo, x.codigo, x.arquivo_id, x.midia_id,
                  case when x.situacao = 'pendente' then null else now() end
             from unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::uuid[], $8::uuid[]) as x(indice, caminho, situacao, motivo, codigo, arquivo_id, midia_id)
           on conflict (tenant_id, lote_id, indice) do nothing`,
          [lote.id, f.map((x) => x.indice), f.map((x) => x.caminho), f.map((x) => x.situacao), f.map((x) => x.motivo), f.map((x) => x.codigo), f.map(() => randomUUID()), f.map(() => randomUUID())],
        );
      }
      await t.db.query(`update catalogo.foto_lote set situacao = 'processando' where id = $1::uuid and situacao = 'conferindo'`, [lote.id]);
    });
    ctx.log.info({ itens: itens.length }, 'lote de fotos conferido');
    return 'continua';
  } finally {
    await zip.fechar();
  }
}

async function produtosDosCodigos(ctx: ContextoTrabalho, codigos: readonly string[]): Promise<ProdutoParaCasar[]> {
  const achados = new Map<string, ProdutoParaCasar>();
  for (let i = 0; i < codigos.length; i += CODIGOS_POR_CONSULTA) {
    const fatia = codigos.slice(i, i + CODIGOS_POR_CONSULTA);
    const r = await ctx.emTransacao((t) => t.consultar(CONSULTA_PRODUTOS_POR_SKU, { codigos: fatia }));
    for (const p of r.produtos) achados.set(p.id, p);
  }
  return [...achados.values()];
}

/** Resultado de um item a gravar. */
interface Desfecho {
  situacao: Exclude<SituacaoItem, 'pendente'>;
  motivo?: MotivoItem | null;
  tipo?: TipoImagem | null;
  codigo?: string | null;
  ordem?: number | null;
  produtoId?: string | null;
  produtoCodigo?: string | null;
  candidatos?: string[] | null;
  sha256?: string | null;
}

const SQL_FECHAR_ITEM = `update catalogo.foto_lote_item
     set situacao = $2, motivo = $3, tipo_detectado = $4, codigo = $5, ordem = $6::smallint, produto_id = $7::uuid, produto_codigo = $8,
         codigos_candidatos = $9::text[], sha256 = $10, processado_em = now()
   where id = $1::uuid and situacao = 'pendente'`;

const valoresDoDesfecho = (id: string, d: Desfecho, codigoPadrao: string | null): unknown[] => [
  id, d.situacao, d.motivo ?? null, d.tipo ?? null, d.codigo ?? codigoPadrao, d.ordem ?? null, d.produtoId ?? null, d.produtoCodigo ?? null, d.candidatos ?? null, d.sha256 ?? null,
];

async function fecharItem(ctx: ContextoTrabalho, item: ItemPendente, d: Desfecho, codigoPadrao: string | null): Promise<void> {
  await ctx.emTransacao((t) => t.db.query(SQL_FECHAR_ITEM, valoresDoDesfecho(item.id, d, codigoPadrao)));
}

async function ligarItem(ctx: ContextoTrabalho, lote: LinhaLote, zip: ZipAberto, item: ItemPendente, produto: ProdutoParaCasar, ordem: number, codigo: string): Promise<void> {
  const lida = await zip.ler(item.indice, { tipos: TIPOS_FOTO_LOTE });
  if (!lida.ok) {
    await fecharItem(ctx, item, { situacao: 'recusado', motivo: lida.motivo, tipo: lida.tipo_detectado }, codigo);
    return;
  }
  const comum = { tipo: lida.tipo, codigo, ordem, produtoId: produto.id, produtoCodigo: produto.sku, sha256: lida.sha256 } as const;
  // mesma imagem já viva no produto: repetido, sem gravar bytes (RN-CAT-14)
  const viva = await ctx.emTransacao((t) =>
    t.db.query(`select 1 from catalogo.produto_midia where produto_id = $1::uuid and tipo = 'foto' and hash_conteudo = $2 and deleted_at is null limit 1`, [produto.id, lida.sha256]),
  );
  if ((viva.rowCount ?? viva.rows.length) > 0) {
    await fecharItem(ctx, item, { situacao: 'repetido', ...comum }, codigo);
    return;
  }
  // bytes e miniatura FORA da transação; o mesmo arquivo_id regrava a mesma chave se a fatia repetir
  const guardada = await ctx.arquivos.guardarImagem({ id: item.arquivo_id, bytes: lida.bytes, tipo: lida.tipo });
  if (!guardada.ok) {
    await fecharItem(ctx, item, { situacao: 'recusado', motivo: guardada.motivo, tipo: lida.tipo }, codigo);
    return;
  }
  await ctx.emTransacao(async (t) => {
    await t.db.query('savepoint item_foto');
    try {
      const [r] = await definirFotosProduto(t, ctx.tenantId, produto.id, [{ id: item.midia_id, ordem, arquivoId: item.arquivo_id, hashConteudo: lida.sha256 }], { tipo: 'lote', loteId: lote.id }, ctx.agora());
      if (r!.resultado === 'ligada') {
        await t.registrarArquivo({ id: item.arquivo_id, finalidade: 'foto_produto', entidade: 'produto', entidade_id: produto.id, tipo: lida.tipo, cliente_id: null, enviado_por: lote.enviado_por, recebido: guardada.recebido });
      }
      const fechou = await t.db.query(SQL_FECHAR_ITEM, valoresDoDesfecho(item.id, { situacao: r!.resultado === 'ligada' ? 'ligado' : 'repetido', ...comum }, codigo));
      // outro processo já fechou este item: não deixa a mídia nova para trás
      if ((fechou.rowCount ?? 0) === 0) await t.db.query('rollback to savepoint item_foto');
      else await t.db.query('release savepoint item_foto');
    } catch (e) {
      const erro = e as { code?: string; constraint?: string };
      await t.db.query('rollback to savepoint item_foto');
      // outro arquivo do mesmo ZIP já ocupa essa posição do produto (ex.: SKU.jpg e SKU_1.jpg): este é recusado
      if (erro.code === '23505' && erro.constraint === 'foto_lote_item_ordem_uk') {
        await t.db.query(SQL_FECHAR_ITEM, valoresDoDesfecho(item.id, { situacao: 'recusado', motivo: 'ordem_repetida_no_lote', tipo: lida.tipo, codigo }, codigo));
        return;
      }
      throw e;
    }
  });
}

async function processarItens(ctx: ContextoTrabalho, lote: LinhaLote): Promise<'continua' | 'concluido'> {
  const pendentes = await ctx.emTransacao((t) =>
    t.db.query<ItemPendente>(
      `select id, indice, caminho, arquivo_id, midia_id from catalogo.foto_lote_item
        where lote_id = $1::uuid and situacao = 'pendente' and deleted_at is null order by indice limit $2::int`,
      [lote.id, ITENS_POR_FATIA],
    ),
  );
  if (pendentes.rows.length === 0) {
    await encerrar(ctx, lote, 'concluido');
    return 'concluido';
  }
  const interpretados = pendentes.rows.map((item) => {
    const n = interpretarNome(nomeBaseDoCaminho(item.caminho));
    return { item, interpretacoes: n.ok ? n.interpretacoes : ([] as InterpretacaoNome[]) };
  });
  const produtos = await produtosDosCodigos(ctx, codigosParaConsulta(interpretados.map((x) => x.interpretacoes)));
  const aberto = await ctx.arquivos.abrirZip(lote.arquivo_id, limitesFotoLote(ctx.parametros()));
  if (!aberto.ok) throw Object.assign(new Error(aberto.motivo), { codigo: `ZIP_${aberto.motivo.toUpperCase()}` });
  const zip = aberto.zip;
  try {
    for (const { item, interpretacoes } of interpretados) {
      if (ctx.deveParar()) break;
      const codigo = interpretacoes[0]?.codigo ?? null;
      const r = resolverItem(interpretacoes, produtos);
      if (r.situacao === 'sem_produto') await fecharItem(ctx, item, { situacao: 'sem_produto' }, codigo);
      else if (r.situacao === 'ambiguo') await fecharItem(ctx, item, { situacao: 'ambiguo', candidatos: r.codigos }, codigo);
      else await ligarItem(ctx, lote, zip, item, r.produto, r.ordem, codigo ?? r.produto.sku);
    }
  } finally {
    await zip.fechar();
    // a vitrine e a busca leem o retrato do catálogo: a foto mudou
    esquecerRetratoCatalogo(ctx.tenantId);
  }
  return 'continua';
}

export const trabalhoProcessarFotoLote = definirTrabalho({
  nome: 'processar_foto_lote',
  disparadoPor: EVENTO_FOTO_LOTE_ENFILEIRADO,
  alvo: (payload) => payload.lote_id,
  async executarFatia(alvoId, ctx) {
    const lote = await ctx.emTransacao((t) => lerLote(t.db, alvoId));
    if (!lote || SITUACOES_FINAIS.includes(lote.situacao)) return 'concluido';
    if (lote.situacao === 'enfileirado' || lote.situacao === 'conferindo') return conferir(ctx, lote);
    if (lote.situacao === 'processando') return processarItens(ctx, lote);
    // aguardando_envio: o evento só sai ao enfileirar; se chegou aqui, não há o que processar
    return 'concluido';
  },
  async aoFalhar(alvoId, ctx, erro) {
    const lote = await ctx.emTransacao((t) => lerLote(t.db, alvoId));
    if (!lote) return;
    ctx.log.error({ codigo: erro.codigo }, 'lote de fotos falhou');
    await encerrar(ctx, lote, 'falhou');
  },
});
