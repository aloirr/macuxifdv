/**
 * Conectores no BKO (`/v1/integracao/conectores`): listar (`monitor.ver`), cadastrar e editar (`conector.gerenciar`, só admin).
 * RN-INT-13 (P-6/P-7): numa empresa cada entidade vem de um único Conector ativo e só um recebe pedidos. A conferência roda DENTRO
 * da transação, depois do `pg_advisory_xact_lock` por empresa: dois cadastros simultâneos não passam juntos. Conflito = 409
 * `topologia_conflitante` com a mensagem do domain e `conflitos`/`entidades_livres` em `detalhes` (ErroApi, ADR 0008).
 * `POST conectores/:id/chave` gera chave nova para Conector ativo existente (RN-INT-10): a atual vira `anterior` com convivência.
 * A chave de API (RN-INT-10) nasce no cadastro, aparece UMA vez na resposta e fica só como HMAC com o pepper do `.env`.
 */
import { randomUUID } from 'node:crypto';
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { ConectorAtualizar, ConectorCriar, ConectoresQuery, RotacionarChaveEntrada, type ChaveNovaConector, type ConectorCriado, type ConectorResumo, type Entidade } from '../contracts';
import { rotacionarChaves, verificarTopologiaConectores, type ChaveRef, type ConectorTopologia } from '../domain';
import { COLUNAS_CONECTOR, lerChaves, lerPolitica, montarResumo, type LinhaConector } from './bko-comum';
import { lerParametrosHub } from './parametros';
import { entradaDeIpValida, gerarChave, hashDaChave, pepperValido } from './chave';

const Params = z.object({ id: z.string().uuid('UUID inválido') });

/** Trava de topologia por empresa, liberada no fim da transação. */
const travarTopologia = (db: ClienteBanco, tenantId: string) =>
  db.query(`select pg_advisory_xact_lock(hashtextextended('integracao.topologia:' || $1::text, 0))`, [tenantId]);

const topologia = (c: Pick<LinhaConector, 'id' | 'identificador' | 'ativo' | 'recebe_pedidos' | 'entidades'>): ConectorTopologia => ({
  id: c.id,
  conector_id: c.identificador,
  ativo: c.ativo,
  recebe_pedidos: c.recebe_pedidos,
  entidades: c.entidades,
});

function conferirIps(ips: readonly string[] | undefined): void {
  const ruins = (ips ?? []).filter((ip) => !entradaDeIpValida(ip));
  if (ruins.length > 0) {
    throw new ErroRegraNegocio('RN-INT-10', `Há endereço de IP inválido na lista do Conector (${ruins.map((r) => `"${r}"`).join(', ')}). Use um IP (203.0.113.5) ou uma faixa CIDR (203.0.113.0/24).`);
  }
}

function recusarTopologia(r: ReturnType<typeof verificarTopologiaConectores>): void {
  if (!r.ok) throw new ErroHttpModulo(409, 'topologia_conflitante', r.mensagem, { conflitos: r.conflitos, entidades_livres: r.entidades_livres });
}

/** Segredo do servidor para gerar chave de Conector; sem ele a rota responde 503. */
function exigirPepper(o: { pepper: () => string | undefined }, ctx: Pick<ContextoRota<unknown>, 'log'>): string {
  const pepper = o.pepper();
  if (!pepperValido(pepper)) {
    ctx.log.error({ motivo: 'sem_pepper' }, 'MACUXI_HUB_CHAVE_PEPPER ausente ou curto: não é possível gerar chave de Conector');
    throw new ErroHttpModulo(503, 'servico_indisponivel', 'O Hub não está configurado para gerar chaves de Conector (falta o segredo do servidor). Avise o suporte do Macuxi.');
  }
  return pepper;
}

export function criarRotasConectores(o: { pepper: () => string | undefined }): RotaModulo[] {
  const listar: RotaModulo = {
    metodo: 'GET',
    caminho: 'conectores',
    acao: 'monitor.ver',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    query: ConectoresQuery,
    executar: async (ctx: ContextoRota<unknown, ConectoresQuery>): Promise<{ itens: ConectorResumo[] }> =>
      ctx.comTenant(async (db) => {
        const tenantId = ctx.usuario.tenant_id;
        const tipo = ctx.query?.tipo ?? null;
        const { rows } = await db.query<LinhaConector>(
          `select ${COLUNAS_CONECTOR} from integracao.conector where tenant_id = $1 and deleted_at is null and ($2::text is null or tipo = $2) order by identificador`,
          [tenantId, tipo],
        );
        const chaves = await lerChaves(db, tenantId, rows.map((r) => r.id));
        const politica = await lerPolitica(db, tenantId);
        const agora = ctx.agora().toISOString();
        return { itens: rows.map((c) => montarResumo(c, chaves.get(c.id), politica, agora)) };
      }),
  };

  const criar: RotaModulo = {
    metodo: 'POST',
    caminho: 'conectores',
    acao: 'conector.gerenciar',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    corpo: ConectorCriar,
    status: 201,
    executar: async (ctx: ContextoRota<ConectorCriar>): Promise<ConectorCriado> => {
      const pepper = exigirPepper(o, ctx);
      const c = ctx.corpo;
      conferirIps(c.ips_permitidos);
      const tenantId = ctx.usuario.tenant_id;
      const agora = ctx.agora().toISOString();
      return ctx.comTenant(async (db, tx) => {
        await travarTopologia(db, tenantId);
        const { rows: existentes } = await db.query<LinhaConector>(`select ${COLUNAS_CONECTOR} from integracao.conector where tenant_id = $1 and deleted_at is null`, [tenantId]);
        if (existentes.some((e) => e.identificador === c.conector_id)) {
          throw new ErroHttpModulo(409, 'conector_ja_existe', `Já existe um Conector com o identificador "${c.conector_id}" nesta empresa. Escolha outro identificador ou edite o existente.`);
        }
        const id = randomUUID();
        recusarTopologia(verificarTopologiaConectores({ id, conector_id: c.conector_id, ativo: true, recebe_pedidos: c.recebe_pedidos, entidades: c.entidades }, existentes.map(topologia)));

        const { rows } = await db.query<LinhaConector>(
          `insert into integracao.conector (id, tenant_id, identificador, nome, tipo, recebe_pedidos, entidades, ips_permitidos, aceita_cancelamento)
           values ($1, $2, $3, $4, $5, $6, $7::text[], $8::inet[], $9)
           returning ${COLUNAS_CONECTOR}`,
          [id, tenantId, c.conector_id, c.nome, c.tipo, c.recebe_pedidos, c.entidades, c.ips_permitidos, c.aceita_cancelamento],
        );
        const k = gerarChave();
        await db.query(`insert into integracao.credencial (tenant_id, conector_id, prefixo, hash_chave, papel) values ($1, $2, $3, $4, 'atual')`, [tenantId, id, k.prefixo, hashDaChave(pepper, k.chave)]);
        await tx.auditar({ acao: 'conector.criar', entidade: 'conector', entidade_id: id, depois: { identificador: c.conector_id, entidades: c.entidades, recebe_pedidos: c.recebe_pedidos, aceita_cancelamento: c.aceita_cancelamento } });
        const linha = rows[0] as LinhaConector;
        const chaves = await lerChaves(db, tenantId, [id]);
        const politica = await lerPolitica(db, tenantId);
        return {
          conector: montarResumo(linha, chaves.get(id), politica, agora),
          chave: { conector_id: c.conector_id, escopo: 'integracao.v1', chave: k.chave, prefixo: k.prefixo, criada_em: agora, anterior_valida_ate: null },
        };
      });
    },
  };

  const atualizar: RotaModulo = {
    metodo: 'PATCH',
    caminho: 'conectores/:id',
    acao: 'conector.gerenciar',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    params: Params,
    corpo: ConectorAtualizar,
    executar: async (ctx: ContextoRota<ConectorAtualizar, unknown, z.infer<typeof Params>>): Promise<ConectorResumo> => {
      const c = ctx.corpo;
      conferirIps(c.ips_permitidos);
      const tenantId = ctx.usuario.tenant_id;
      const agora = ctx.agora().toISOString();
      return ctx.comTenant(async (db, tx) => {
        await travarTopologia(db, tenantId);
        const { rows: todos } = await db.query<LinhaConector>(`select ${COLUNAS_CONECTOR} from integracao.conector where tenant_id = $1 and deleted_at is null`, [tenantId]);
        const atual = todos.find((x) => x.id === ctx.params.id);
        if (!atual) throw new ErroNaoEncontrado('CONECTOR_NAO_ENCONTRADO', 'Conector não encontrado. Atualize a lista em Integração ERP > Conectores.');

        const novo = {
          nome: c.nome ?? atual.nome,
          ips_permitidos: c.ips_permitidos ?? atual.ips_permitidos,
          recebe_pedidos: c.recebe_pedidos ?? atual.recebe_pedidos,
          entidades: (c.entidades ?? atual.entidades) as Entidade[],
          ativo: c.ativo ?? atual.ativo,
          aceita_cancelamento: c.aceita_cancelamento ?? atual.aceita_cancelamento,
        };
        // ativo (ou sendo reativado) confere de novo contra os OUTROS Conectores ativos; desativar sempre pode (RN-INT-13)
        recusarTopologia(verificarTopologiaConectores({ id: atual.id, conector_id: atual.identificador, ...novo }, todos.filter((x) => x.id !== atual.id).map(topologia)));

        const { rows } = await db.query<LinhaConector>(
          `update integracao.conector set nome = $3, ips_permitidos = $4::inet[], recebe_pedidos = $5, entidades = $6::text[], ativo = $7, aceita_cancelamento = $8
            where tenant_id = $1 and id = $2
            returning ${COLUNAS_CONECTOR}`,
          [tenantId, atual.id, novo.nome, novo.ips_permitidos, novo.recebe_pedidos, novo.entidades, novo.ativo, novo.aceita_cancelamento],
        );
        // desativar o Conector revoga as chaves (RN-INT-10); reativar exige gerar chave nova
        if (atual.ativo && !novo.ativo) {
          await db.query(
            `update integracao.credencial set revogada_em = $3, revogada_por = $4, motivo_revogacao = 'Conector desativado'
              where tenant_id = $1 and conector_id = $2 and revogada_em is null`,
            [tenantId, atual.id, agora, ctx.superAdmin ? null : ctx.usuario.id],
          );
        }
        await tx.auditar({
          acao: 'conector.atualizar',
          entidade: 'conector',
          entidade_id: atual.id,
          antes: { ativo: atual.ativo, recebe_pedidos: atual.recebe_pedidos, aceita_cancelamento: atual.aceita_cancelamento, entidades: atual.entidades },
          depois: { ativo: novo.ativo, recebe_pedidos: novo.recebe_pedidos, aceita_cancelamento: novo.aceita_cancelamento, entidades: novo.entidades },
        });
        const chaves = await lerChaves(db, tenantId, [atual.id]);
        const politica = await lerPolitica(db, tenantId);
        return montarResumo(rows[0] as LinhaConector, chaves.get(atual.id), politica, agora);
      });
    },
  };

  const gerarChaveNova: RotaModulo = {
    metodo: 'POST',
    caminho: 'conectores/:id/chave',
    acao: 'conector.gerenciar',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    params: Params,
    corpo: RotacionarChaveEntrada.optional(),
    status: 201,
    executar: async (ctx: ContextoRota<RotacionarChaveEntrada | undefined, unknown, z.infer<typeof Params>>): Promise<ChaveNovaConector> => {
      const pepper = exigirPepper(o, ctx);
      const tenantId = ctx.usuario.tenant_id;
      const agora = ctx.agora().toISOString();
      const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
      return ctx.comTenant(async (db, tx) => {
        const { rows: achados } = await db.query<{ id: string; identificador: string; ativo: boolean }>(
          'select id, identificador, ativo from integracao.conector where tenant_id = $1 and id = $2 and deleted_at is null for update',
          [tenantId, ctx.params.id],
        );
        const conector = achados[0];
        if (!conector) throw new ErroNaoEncontrado('CONECTOR_NAO_ENCONTRADO', 'Conector não encontrado. Atualize a lista em Integração ERP > Conectores.');
        if (!conector.ativo) {
          throw new ErroHttpModulo(409, 'conector_inativo', `O Conector "${conector.identificador}" está desativado. Reative o Conector antes de gerar uma chave nova.`);
        }
        const { rows } = await db.query<{ id: string; papel: 'atual' | 'anterior'; prefixo: string; created_at: Date; expira_em: Date | null; anterior_valida_ate: Date | null }>(
          `select id, papel, prefixo, created_at, expira_em, anterior_valida_ate from integracao.credencial
            where tenant_id = $1 and conector_id = $2 and revogada_em is null and deleted_at is null for update`,
          [tenantId, conector.id],
        );
        const ref = (r: (typeof rows)[number] | undefined): ChaveRef | null =>
          r ? { id: r.id, prefixo: r.prefixo, criada_em: r.created_at.toISOString(), expira_em: r.expira_em?.toISOString() ?? null, revogada_em: null, anterior_valida_ate: r.anterior_valida_ate?.toISOString() ?? null } : null;
        const atualAntiga = rows.find((x) => x.papel === 'atual');
        const k = gerarChave();
        const idNova = randomUUID();
        const r = rotacionarChaves(
          { atual: ref(atualAntiga), anterior: ref(rows.find((x) => x.papel === 'anterior')) },
          { id: idNova, prefixo: k.prefixo },
          agora,
          { convivenciaMin: ctx.corpo?.convivencia_min ?? parametros.convivenciaChaveMin, convivenciaMaxMin: parametros.convivenciaChaveMaxMin },
        );
        if (!r.ok) throw new ErroRegraNegocio('RN-INT-10', r.mensagem);
        // ordem importa por causa do índice único (conector, papel) das não revogadas: libera 'anterior', rebaixa a 'atual' e só então insere
        for (const idRev of r.revogadas) {
          await db.query(`update integracao.credencial set revogada_em = $3, revogada_por = $4, motivo_revogacao = 'Chave trocada' where tenant_id = $1 and id = $2`, [tenantId, idRev, agora, ctx.superAdmin ? null : ctx.usuario.id]);
        }
        if (atualAntiga) {
          await db.query(`update integracao.credencial set papel = 'anterior', anterior_valida_ate = $3 where tenant_id = $1 and id = $2`, [tenantId, atualAntiga.id, r.chaves.anterior?.anterior_valida_ate ?? agora]);
        }
        await db.query(`insert into integracao.credencial (id, tenant_id, conector_id, prefixo, hash_chave, papel) values ($1, $2, $3, $4, $5, 'atual')`, [idNova, tenantId, conector.id, k.prefixo, hashDaChave(pepper, k.chave)]);
        // a auditoria leva só conector, prefixo e prazo; nunca a chave
        await tx.auditar({
          acao: 'conector.chave_gerar',
          entidade: 'conector',
          entidade_id: conector.id,
          depois: { identificador: conector.identificador, prefixo: k.prefixo, anterior_valida_ate: r.anterior_valida_ate },
        });
        return { conector_id: conector.identificador, escopo: 'integracao.v1', chave: k.chave, prefixo: k.prefixo, criada_em: agora, anterior_valida_ate: r.anterior_valida_ate };
      });
    },
  };

  return [listar, criar, atualizar, gerarChaveNova];
}
