/**
 * Rotas `/v1/core` da T-0191 (desenho docs/desenho/T-0191.md §4; RN-CORE-04, 75, 76 e 77; RN-AUD-01):
 * endereço da casa e base do vendedor, prévia e lote da rota criada por proximidade e "Gerar coordenada" do cliente.
 * Todas por `ctx.comTenant` (RLS); usuário fora do escopo é 404. Endereço é dado pessoal: nunca vai para log nem auditoria.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, chaveGeocodificacao, erroGeocodificadorIndisponivel, type ClienteBanco, type ContextoBase, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  BaseDoUsuarioRespostaSchema,
  EVENTO_CLIENTE_ATUALIZADO,
  EnderecoCasaRespostaSchema,
  PreviaRotaPedidoSchema,
  SalvarBaseSchema,
  SalvarEnderecoCasaSchema,
  SalvarRotasLoteSchema,
  type BaseDoUsuarioResposta,
  type EnderecoCasaResposta,
  CODIGOS_GERAR_COORDENADA,
  CODIGOS_ROTA_LOTE,
  type GerarCoordenadaResposta,
  type PreviaRotaResposta,
  type SalvarRotasLoteResposta,
} from '../contracts';
import {
  MENSAGENS_RECUSA_GERACAO,
  MENSAGEM_SEM_ENDERECO_CADASTRO,
  enderecoPermiteGerar,
  arredondarCoordenada,
  classificarDias,
  criarRotasPorProximidade,
  dataLocal,
  decidirGeracaoDeCoordenada,
  limiteVisitasPorDia,
  perfilTemEndereco,
  rotaProtegida,
  totaisDaPrevia,
  type ClienteParaRota,
  type RotaExistente,
} from '../domain';
import { metaProdutividadeVigente, type EquipeArvore } from '../domain/performance/metas-produtividade';
import { auditar } from './auditoria';
import { baseDaLinha, calendarioDoTenantNaTransacao, casaDaLinha, lerEnderecoDoUsuario } from './base-usuario';
import { DONOS_DA_CARTEIRA_DA_ROTA, carteiraDoEvento, checarUsuario, gravarRota } from './rotas';
import { linhasVivas } from './metas-produtividade';

const IdParam = z.object({ id: z.string().uuid() });

// ---------- endereço da casa e base (RN-CORE-75) ----------

const COLUNAS_CASA = ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'lat', 'lng'] as const;

async function usuarioComEndereco(ctx: ContextoBase, db: ClienteBanco, id: string) {
  await checarUsuario(ctx, db, id);
  const linha = await lerEnderecoDoUsuario(db, id);
  if (!linha) throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado na sua equipe. Atualize a lista e tente de novo.');
  return linha;
}

const rotasDeEnderecoEBase: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'usuarios/:id/endereco',
    acao: 'usuario.ver',
    carteira: 'filtrar_no_dominio',
    params: IdParam,
    executar: (ctx): Promise<EnderecoCasaResposta> =>
      ctx.comTenant(async (db) => EnderecoCasaRespostaSchema.parse({ endereco: casaDaLinha(await usuarioComEndereco(ctx, db, ctx.params.id)) })),
  },
  {
    metodo: 'PUT',
    caminho: 'usuarios/:id/endereco',
    acao: 'usuario.editar',
    carteira: 'filtrar_no_dominio',
    params: IdParam,
    corpo: SalvarEnderecoCasaSchema,
    executar: (ctx): Promise<EnderecoCasaResposta> =>
      ctx.comTenant(async (db) => {
        const antes = await usuarioComEndereco(ctx, db, ctx.params.id);
        if (!perfilTemEndereco(antes.perfil)) throw new ErroRegraNegocio('USUARIO_SEM_ENDERECO', 'Só vendedor e promotor têm endereço de casa. Escolha outro usuário.');
        const e = ctx.corpo.endereco;
        const valores = COLUNAS_CASA.map((c) => e?.[c] ?? null);
        await db.query(
          `update core.usuario set casa_cep = $2, casa_logradouro = $3, casa_numero = $4, casa_bairro = $5, casa_cidade = $6, casa_uf = $7, casa_lat = $8, casa_lng = $9 where id = $1`,
          [ctx.params.id, ...valores],
        );
        // sem o endereço: só se há casa e se o ponto está marcado
        await auditar(db, ctx, {
          acao: 'usuario.endereco_editar',
          entidade: 'usuario',
          entidadeId: ctx.params.id,
          antes: { definido: casaDaLinha(antes) !== null },
          depois: { definido: e !== null, ponto_marcado: e?.lat != null },
        });
        return EnderecoCasaRespostaSchema.parse({ endereco: casaDaLinha(await usuarioComEndereco(ctx, db, ctx.params.id)) });
      }),
  },
  {
    // o diálogo "Endereço base" lê a casa e a base de quem pode editar rotas (o analista pode não ter `usuario.ver`)
    metodo: 'GET',
    caminho: 'usuarios/:id/base',
    acao: 'rota.editar',
    carteira: 'filtrar_no_dominio',
    params: IdParam,
    executar: (ctx): Promise<BaseDoUsuarioResposta> =>
      ctx.comTenant(async (db) => {
        const l = await usuarioComEndereco(ctx, db, ctx.params.id);
        return BaseDoUsuarioRespostaSchema.parse({ casa: casaDaLinha(l), base: baseDaLinha(l) });
      }),
  },
  {
    metodo: 'PUT',
    caminho: 'usuarios/:id/base',
    acao: 'rota.editar',
    carteira: 'filtrar_no_dominio',
    params: IdParam,
    corpo: SalvarBaseSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const antes = await usuarioComEndereco(ctx, db, ctx.params.id);
        if (!perfilTemEndereco(antes.perfil)) throw new ErroRegraNegocio('USUARIO_SEM_ENDERECO', 'Só vendedor e promotor têm base de rota. Escolha outro usuário.');
        const c = ctx.corpo;
        if (c.tipo === 'casa') {
          if (antes.casa_lat === null || antes.casa_lng === null) {
            throw new ErroRegraNegocio('BASE_SEM_PONTO', 'A casa ainda não tem o ponto marcado no mapa. Marque em Usuários, no endereço do vendedor, ou escolha Outro endereço.', { regra: 'RN-CORE-75' });
          }
          await db.query("update core.usuario set base_tipo = 'casa', base_alterada_em = now() where id = $1", [ctx.params.id]);
        } else {
          const e = c.endereco;
          await db.query(
            `update core.usuario set base_tipo = 'outro', base_cep = $2, base_logradouro = $3, base_numero = $4, base_bairro = $5, base_cidade = $6, base_uf = $7, base_lat = $8, base_lng = $9, base_alterada_em = now() where id = $1`,
            [ctx.params.id, e.cep, e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.lat, e.lng],
          );
        }
        await auditar(db, ctx, { acao: 'usuario.base_editar', entidade: 'usuario', entidadeId: ctx.params.id, antes: { base_tipo: antes.base_tipo }, depois: { base_tipo: c.tipo } });
        return baseDaLinha(await usuarioComEndereco(ctx, db, ctx.params.id));
      }),
  },
];

// ---------- prévia e lote (RN-CORE-76) ----------

interface ClienteDaCarteira extends ClienteParaRota {
  nome: string;
  cidade: string | null;
  bairro: string | null;
  logradouro: string | null;
  numero: string | null;
  uf: string | null;
  cep: string | null;
  geocodificacao_chave: string | null;
}

async function carteiraDoPeriodo(db: ClienteBanco, usuarioId: string, de: string, ate: string): Promise<ClienteDaCarteira[]> {
  return (
    await db.query<ClienteDaCarteira>(
      `${DONOS_DA_CARTEIRA_DA_ROTA}
       select distinct on (c.id) c.id as cliente_id, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as nome, c.cidade, c.bairro, c.logradouro, c.numero, c.uf, c.cep,
              c.latitude::float8 as lat, c.longitude::float8 as lng, c.geocodificacao_chave,
              k.frequencia_semanas, k.dia_semana, to_char(k.inicio, 'YYYY-MM-DD') as inicio, to_char(k.fim, 'YYYY-MM-DD') as fim
         from core.carteira k join core.cliente c on c.id = k.cliente_id and c.deleted_at is null and c.ativo
        where k.usuario_id in (select id from donos) and k.deleted_at is null
          and (k.fim is null or k.fim >= $2::date) and (k.inicio is null or k.inicio <= $3::date)
        order by c.id, k.created_at
        limit 5000`,
      [usuarioId, de, ate],
    )
  ).rows;
}

async function limiteDoVendedor(db: ClienteBanco, usuarioId: string, mes: string): Promise<number> {
  const u = (await db.query<{ equipe_id: string | null }>('select equipe_id from core.usuario where id = $1', [usuarioId])).rows[0];
  const equipes = (await db.query<EquipeArvore>('select id, equipe_pai_id from core.equipe where deleted_at is null')).rows;
  const meta = metaProdutividadeVigente({ linhas: await linhasVivas(db), equipes, alvo: { usuario_id: usuarioId, equipe_id: u?.equipe_id ?? null }, mes, indicador: 'visitas_dia' });
  return limiteVisitasPorDia(meta.valor);
}

async function rotasExistentes(db: ClienteBanco, usuarioId: string, de: string, ate: string): Promise<Array<RotaExistente & { id: string; origem: string }>> {
  const linhas = (
    await db.query<{ id: string; data: string; origem: string; visitas: number; com_visita: boolean }>(
      `select r.id, to_char(r.data, 'YYYY-MM-DD') as data, r.origem,
              (select count(*)::int from core.rota_parada p where p.rota_id = r.id and p.deleted_at is null) as visitas,
              exists (select 1 from core.visita v where v.usuario_id = r.usuario_id and v.data_local = r.data and v.deleted_at is null) as com_visita
         from core.rota r where r.usuario_id = $1 and r.deleted_at is null and r.data between $2::date and $3::date`,
      [usuarioId, de, ate],
    )
  ).rows;
  return linhas.map((l) => ({ id: l.id, data: l.data, origem: l.origem, visitas: l.visitas, protegida: rotaProtegida({ origem: l.origem, com_visita: l.com_visita }) }));
}

/** A rota já tem exatamente estas paradas (cliente, ordem e janela)? Base da repetição idêntica do Substituir. */
async function mesmasParadas(db: ClienteBanco, rotaId: string, paradas: ReadonlyArray<{ cliente_id: string; janela_inicio?: string | null; janela_fim?: string | null }>): Promise<boolean> {
  const atuais = (
    await db.query<{ cliente_id: string; ini: string | null; fim: string | null }>(
      "select cliente_id, to_char(janela_inicio, 'HH24:MI') as ini, to_char(janela_fim, 'HH24:MI') as fim from core.rota_parada where rota_id = $1 and deleted_at is null order by sequencia",
      [rotaId],
    )
  ).rows;
  const hm = (v?: string | null) => (v ? v.slice(0, 5) : null);
  return atuais.length === paradas.length && atuais.every((a, i) => a.cliente_id === paradas[i]!.cliente_id && a.ini === hm(paradas[i]!.janela_inicio) && a.fim === hm(paradas[i]!.janela_fim));
}

/** Contexto comum da prévia e do lote: tudo o que a conta do domain precisa, lido uma vez. */
async function contextoDaCriacao(ctx: ContextoBase, db: ClienteBanco, p: { usuario_id: string; de: string; ate: string; modo: 'so_vazios' | 'substituir' }) {
  await checarUsuario(ctx, db, p.usuario_id);
  const calendario = await calendarioDoTenantNaTransacao(db);
  const existentes = await rotasExistentes(db, p.usuario_id, p.de, p.ate);
  const linha = await lerEnderecoDoUsuario(db, p.usuario_id);
  const base = linha ? baseDaLinha(linha) : null;
  const carteira = await carteiraDoPeriodo(db, p.usuario_id, p.de, p.ate);
  const limite = await limiteDoVendedor(db, p.usuario_id, p.ate.slice(0, 7));
  return {
    base,
    carteira,
    limite,
    entrada: {
      de: p.de,
      ate: p.ate,
      hoje: dataLocal(ctx.agora(), ctx.fuso()),
      base: base ? { lat: base.lat, lng: base.lng } : null,
      clientes: carteira,
      dias_uteis_semana: calendario.dias_uteis_semana,
      feriados: calendario.feriados,
      limite,
      existentes,
      modo: p.modo,
    },
    existentes,
  };
}

async function montarPrevia(ctx: ContextoBase, db: ClienteBanco, p: { usuario_id: string; de: string; ate: string; modo: 'so_vazios' | 'substituir' }): Promise<PreviaRotaResposta> {
  const c = await contextoDaCriacao(ctx, db, p);
  const r = criarRotasPorProximidade(c.entrada);
  const porId = new Map(c.carteira.map((x) => [x.cliente_id, x]));
  const dias = r.dias.map((d) => ({
    data: d.data,
    visitas: d.cliente_ids.length,
    km: d.km,
    paradas: d.cliente_ids.map((id) => {
      const x = porId.get(id)!;
      return { cliente_id: id, nome: x.nome, cidade: x.cidade, bairro: x.bairro, lat: x.lat!, lng: x.lng! };
    }),
  }));
  return {
    dias,
    totais: totaisDaPrevia(dias),
    fora_sem_coordenada: r.fora_sem_coordenada.map((id) => {
      const x = porId.get(id)!;
      const chave = chaveGeocodificacao({ logradouro: x.logradouro, numero: x.numero, bairro: x.bairro, cidade: x.cidade, uf: x.uf, cep: x.cep });
      return { cliente_id: id, nome: x.nome, logradouro: x.logradouro, numero: x.numero, bairro: x.bairro, cidade: x.cidade, uf: x.uf, cep: x.cep, ja_tentado: x.geocodificacao_chave !== null && x.geocodificacao_chave === chave };
    }),
    fora_limite: r.fora_limite.map((id) => ({ cliente_id: id, nome: porId.get(id)!.nome, cidade: porId.get(id)!.cidade })),
    mantidas: r.mantidas,
    feriados: r.feriados,
    base: c.base,
  };
}

const rotasDeCriarRota: RotaModulo[] = [
  {
    metodo: 'POST',
    caminho: 'rotas/previa',
    acao: 'rota.editar',
    carteira: 'filtrar_no_dominio',
    status: 200,
    corpo: PreviaRotaPedidoSchema,
    // não grava nada
    executar: (ctx): Promise<PreviaRotaResposta> => ctx.comTenant((db) => montarPrevia(ctx, db, ctx.corpo)),
  },
  {
    metodo: 'POST',
    caminho: 'rotas/lote',
    acao: 'rota.editar',
    carteira: 'filtrar_no_dominio',
    status: 200,
    corpo: SalvarRotasLoteSchema,
    executar: (ctx): Promise<SalvarRotasLoteResposta> =>
      ctx.comTenant(async (db) => {
        const { usuario_id, modo, rotas } = ctx.corpo;
        // idempotência sob concorrência (D1): o mesmo lote enviado ao mesmo tempo espera o primeiro commitar e então vê as rotas gravadas
        // (devolve `repetidas`), em vez de estourar a chave duplicada de rota_pkey; a trava é por tenant e vendedor e solta no fim da transação.
        await db.query("select pg_advisory_xact_lock(hashtextextended('rota.lote:' || plataforma.tenant_atual()::text || ':' || $1::text, 0))", [usuario_id]);
        // O lote não revalida o limite `visitas_dia` do dia: a prévia já o aplicou e a edição manual do editor pode passar dele (vale o que a pessoa montou).
        const datas = rotas.map((r: { data: string }) => r.data).sort();
        const c = await contextoDaCriacao(ctx, db, { usuario_id, de: datas[0]!, ate: datas[datas.length - 1]!, modo });
        const { livres, mantidas } = classificarDias(c.entrada);
        const livre = new Set(livres);
        const porData = new Map(c.existentes.map((e) => [e.data, e]));
        let salvas = 0;
        let repetidas = 0;
        let repetidasDoSubstituir = 0;
        const gravadas: string[] = [];
        for (const r of rotas as Array<{ id: string; data: string; paradas: Array<{ cliente_id: string; janela_inicio?: string | null; janela_fim?: string | null }> }>) {
          // idempotência: o mesmo id já gravado (mesmo usuário e dia) não grava de novo
          const ja = (await db.query<{ usuario_id: string; data: string }>("select usuario_id, to_char(data, 'YYYY-MM-DD') as data from core.rota where id = $1 and deleted_at is null", [r.id])).rows[0];
          if (ja) {
            if (ja.usuario_id !== usuario_id || ja.data !== r.data) throw recusaLote('ROTA_EXISTENTE', 'Este lote já foi usado em outra rota. Monte a prévia de novo e salve.');
            repetidas += 1;
            continue;
          }
          // Substituir reenviado: a rota do dia já é do BKO e tem as mesmas paradas, na mesma ordem e janela → repetição (sem gravar nem auditar de novo)
          const atual = porData.get(r.data);
          if (atual && livre.has(r.data) && atual.origem === 'bko' && (await mesmasParadas(db, atual.id, r.paradas))) {
            repetidas += 1;
            repetidasDoSubstituir += 1;
            continue;
          }
          if (!livre.has(r.data)) {
            const m = mantidas.find((x) => x.data === r.data);
            if (m?.protegida) throw recusaLote('ROTA_PROTEGIDA', 'Há um dia com visita feita ou rota do ERP no lote. Monte a prévia de novo: esse dia não é trocado.', 'RN-CORE-76');
            if (m) throw recusaLote('ROTA_EXISTENTE', 'Um dia do lote já tem rota. Monte a prévia de novo ou escolha Substituir.', 'RN-CORE-76');
            throw recusaLote('ROTA_DIA_INVALIDO', 'Um dia do lote não é dia de rota (passado, fora da semana útil ou feriado). Monte a prévia de novo.');
          }
          const rotaId = await gravarRota(db, usuario_id, r.data, r.paradas, 'bko', r.id);
          if (porData.get(r.data)) await db.query("update core.rota set origem = 'bko' where id = $1", [rotaId]);
          gravadas.push(r.data);
          salvas += 1;
        }
        if (gravadas.length > 0 || repetidas > repetidasDoSubstituir) await auditar(db, ctx, { acao: 'rota.lote', entidade: 'rota', entidadeId: null, antes: null, depois: { usuario_id, modo, salvas: gravadas, repetidas } });
        return { salvas: salvas + repetidas, repetidas };
      }),
  },
];

// ---------- gerar coordenada (RN-CORE-77) ----------

interface ClienteParaGeocodificar {
  latitude: number | null;
  longitude: number | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  geocodificacao_chave: string | null;
}

const recusaLote = (codigo: (typeof CODIGOS_ROTA_LOTE)[number], mensagem: string, regra?: string) => new ErroRegraNegocio(codigo, mensagem, regra ? { regra } : undefined);
const recusaGerar = (codigo: (typeof CODIGOS_GERAR_COORDENADA)[number], mensagem: string) => new ErroRegraNegocio(codigo, mensagem, { regra: 'RN-CORE-77' });

const rotasDeGerarCoordenada: RotaModulo[] = [
  {
    metodo: 'POST',
    caminho: 'clientes/:id/coordenada/gerar',
    acao: 'cliente.aprovar_coordenada',
    carteira: (e) => (e.params as { id?: string } | null)?.id,
    status: 200,
    params: IdParam,
    executar: async (ctx): Promise<GerarCoordenadaResposta> => {
      const id: string = ctx.params.id;
      const cliente = await ctx.comTenant(
        async (db) =>
          (
            await db.query<ClienteParaGeocodificar>(
              'select latitude::float8 as latitude, longitude::float8 as longitude, logradouro, numero, bairro, cidade, uf, cep, geocodificacao_chave from core.cliente where id = $1 and deleted_at is null',
              [id],
            )
          ).rows[0],
      );
      if (!cliente) throw new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado. Atualize a lista e tente de novo.');
      const endereco = { logradouro: cliente.logradouro, numero: cliente.numero, bairro: cliente.bairro, cidade: cliente.cidade, uf: cliente.uf, cep: cliente.cep };
      const chave = chaveGeocodificacao(endereco);
      const decisao = decidirGeracaoDeCoordenada({ latitude: cliente.latitude, longitude: cliente.longitude, chaveAtual: chave, chaveTentada: cliente.geocodificacao_chave });
      if (!decisao.ok) throw recusaGerar(decisao.codigo, MENSAGENS_RECUSA_GERACAO[decisao.codigo]);
      if (!enderecoPermiteGerar(endereco)) throw recusaGerar('NAO_LOCALIZADO', MENSAGEM_SEM_ENDERECO_CADASTRO);
      if (!ctx.geocodificador) throw erroGeocodificadorIndisponivel();
      // fora da transação: a fila do serviço (1 requisição por segundo) não segura conexão do banco
      const achou = await ctx.geocodificador.localizar(endereco);
      const lat = achou ? arredondarCoordenada(achou.lat) : null;
      const lng = achou ? arredondarCoordenada(achou.lng) : null;
      const gravou = await ctx.comTenant(async (db, tx) => {
        const r = await db.query(
          `update core.cliente set geocodificacao_tentada_em = now(), geocodificacao_chave = $2, latitude = $3::numeric, longitude = $4::numeric,
                  coordenada_origem = case when $3::numeric is not null then 'geocodificacao' else coordenada_origem end, coordenada_precisao = $5::text
            where id = $1 and deleted_at is null and latitude is null and longitude is null`,
          [id, chave, lat, lng, achou?.precisao ?? null],
        );
        if ((r.rowCount ?? 0) === 0) return false; // outro caminho gravou a coordenada no meio
        await auditar(db, ctx, {
          acao: 'cliente.gerar_coordenada',
          entidade: 'cliente',
          entidadeId: id,
          antes: { tem_coordenada: false },
          depois: { resultado: achou ? 'localizado' : 'nao_localizado', precisao: achou?.precisao ?? null },
        });
        if (achou) await tx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: id, campos: ['latitude', 'longitude'], origem: 'bko', ...(await carteiraDoEvento(db, id)) }, id);
        return true;
      });
      if (!gravou) throw recusaGerar('JA_TEM_COORDENADA', MENSAGENS_RECUSA_GERACAO.JA_TEM_COORDENADA);
      if (!achou || lat === null || lng === null) throw recusaGerar('NAO_LOCALIZADO', MENSAGENS_RECUSA_GERACAO.NAO_LOCALIZADO);
      return { cliente_id: id, lat, lng, precisao: achou.precisao };
    },
  },
];

export const rotasDeCriarRotaEBase: RotaModulo[] = [...rotasDeEnderecoEBase, ...rotasDeCriarRota, ...rotasDeGerarCoordenada];
