/**
 * Push `cliente_foto` (RN-CORE-38; T-0147; ADR 0041): o aparelho envia o comando (`ClienteFotoPushSchema`) e, pela fila de arquivos,
 * os bytes (`PUT /v1/arquivos/:id`). O servidor sempre revalida, item a item, cada um na própria transação:
 *  - carteira (RN-CORE-04): cliente fora da carteira = `FORA_DA_CARTEIRA`;
 *  - tipo vivo e ativo, senão 422 `FOTO_TIPO_NAO_ENCONTRADO`;
 *  - `podeEnviarFoto`: vendedor e promotor só o que falta (422 `RN-CORE-38`); admin, analista e supervisor substituem (a antiga sai logicamente);
 *  - `tx.registrarArquivo` com `perfis_leitura` do tipo (`perfisDeLeitura`): sensível só admin, analista, gerente e supervisor.
 * Idempotente pelo `id` (UUID do aparelho). Sem dado pessoal em log e sem evento.
 */
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import { ERROS_FOTO_PDV } from '../contracts';
import { idDoPayloadConfere, perfisDeLeitura, podeEnviarFoto } from '../domain';
const aceito = (id) => ({ id, status: 'aceito' });
const rejeitado = (id, codigo, mensagem) => ({ id, status: 'rejeitado', codigo, mensagem });
export async function receberFotosPdv(ctx, itens) {
    const visiveis = await ctx.carteira();
    const eu = ctx.usuario.id;
    const perfil = ctx.usuario.perfil;
    const saida = [];
    for (const item of itens) {
        if (item.operacao === 'remover') {
            saida.push(rejeitado(item.id, 'OPERACAO_NAO_SUPORTADA', 'A foto do PDV não pode ser removida pelo aparelho.'));
            continue;
        }
        if (!idDoPayloadConfere(item.id, item.payload)) {
            saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do payload.'));
            continue;
        }
        const p = item.payload;
        try {
            saida.push(await ctx.comTenant(async (db, tx) => {
                // serializa reenvios simultâneos do mesmo comando
                await db.query('select pg_advisory_xact_lock(hashtext($1))', [`cliente_foto:${p.id}`]);
                const ja = (await db.query('select cliente_id, foto_tipo_id, enviado_por from core.cliente_foto where id = $1', [p.id])).rows[0];
                if (ja)
                    return ja.enviado_por === eu && ja.cliente_id === p.cliente_id && ja.foto_tipo_id === p.foto_tipo_id ? aceito(item.id) : rejeitado(item.id, 'ID_EM_USO', 'Este identificador de foto já pertence a outro registro.');
                if (visiveis !== 'tenant' && !visiveis.has(p.cliente_id))
                    return rejeitado(item.id, 'FORA_DA_CARTEIRA', 'Este cliente não está na sua carteira. Atualize os dados e tente de novo.');
                const cli = (await db.query('select 1 from core.cliente where id = $1 and deleted_at is null', [p.cliente_id])).rows[0];
                if (!cli)
                    return rejeitado(item.id, 'FORA_DA_CARTEIRA', 'Cliente não encontrado. Atualize os dados e tente de novo.');
                const tipo = (await db.query('select id, sensivel, fachada, ativo from core.foto_tipo where id = $1 and deleted_at is null', [p.foto_tipo_id])).rows[0];
                if (!tipo || !tipo.ativo)
                    return rejeitado(item.id, ERROS_FOTO_PDV.tipoNaoEncontrado, 'Este tipo de foto não está mais disponível. Atualize os dados e tente de novo.');
                const vigente = (await db.query('select id from core.cliente_foto where cliente_id = $1 and foto_tipo_id = $2 and deleted_at is null', [p.cliente_id, p.foto_tipo_id])).rows[0];
                const pode = podeEnviarFoto(perfil, Boolean(vigente));
                if (!pode.ok)
                    return rejeitado(item.id, pode.codigo, pode.mensagem);
                if (vigente)
                    await db.query('update core.cliente_foto set deleted_at = now() where id = $1', [vigente.id]);
                await db.query(`insert into core.cliente_foto (id, tenant_id, cliente_id, foto_tipo_id, arquivo_id, origem, enviado_por, tirada_em)
             values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`, [p.id, p.cliente_id, p.foto_tipo_id, p.arquivo_id, p.origem, eu, p.tirada_em]);
                await tx.registrarArquivo({
                    id: p.arquivo_id,
                    finalidade: 'pdv',
                    entidade: 'cliente_foto',
                    entidade_id: p.id,
                    cliente_id: p.cliente_id,
                    tipo: 'image/jpeg',
                    perfis_leitura: perfisDeLeitura(tipo),
                });
                return aceito(item.id);
            }));
        }
        catch (e) {
            if (!(e instanceof ErroHttpModulo) || e.status >= 500)
                throw e;
            saida.push(rejeitado(item.id, e.codigo, e.message));
        }
    }
    return saida;
}
