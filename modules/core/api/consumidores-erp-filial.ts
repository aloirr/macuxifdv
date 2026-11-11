/**
 * `integracao.filial.atualizado@1` -> `core.filial` (T-0149; RN-CORE-39; RN-INT-02/04). Upsert idempotente por `external_id`.
 * Sem `external_id` conhecido, a filial é casada pelo CÓDIGO: a padrão nasce `0001` sem `external_id` e é "adotada" pela primeira
 * carga com o mesmo código (mantém o `padrao`). O ERP nunca define nem inativa a padrão: quem muda a padrão é o admin no BKO.
 * Inativação do ERP = `ativo = false` (nunca apaga); o cliente de filial inativa cai na padrão (`filialEfetiva`).
 * Código que já pertence a outra filial do ERP é ignorado com aviso. Cidade/UF ausentes não apagam o que o BKO preencheu.
 * T-0159: CNPJ, endereço e telefone vindos do ERP (campos opcionais do registro) são gravados quando válidos (`dadosFiscaisDoErp`); ausentes ou em
 * branco não apagam o que o BKO preencheu; CNPJ/CEP inválido é ignorado com aviso. A obrigatoriedade (rejeitar a carga sem CNPJ/endereço) é do Hub.
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_ERP_FILIAL_ATUALIZADO } from '../../integracao/contracts';
import { dadosFiscaisDoErp } from '../domain';
import type { FilialDadosFiscais } from '../contracts/filial';

export const EventoIntegracaoFilialAtualizado = eventoTolerante(EVENTO_ERP_FILIAL_ATUALIZADO);

export const consumidorFilialDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoFilialAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const r = p.registro;
    if (p.acao === 'inativado' || !r || r.ativo === false) {
      await ctx.db.query('update core.filial set ativo = false where external_id = $1 and deleted_at is null and ativo and not padrao', [p.external_id]);
      return;
    }
    const codigo = r.codigo.trim();
    const cidade = r.cidade?.trim() || null;
    const uf = r.uf?.trim().toUpperCase() || null;
    const fiscais = dadosFiscaisDoErp(r as FilialDadosFiscais);
    if (fiscais.invalidos.length > 0) ctx.log.warn({ external_id: p.external_id, campos: fiscais.invalidos }, 'filial do ERP com dado fiscal inválido: campos ignorados');
    const d = fiscais.dados;
    const valores = [d.cnpj ?? null, d.logradouro ?? null, d.numero ?? null, d.complemento ?? null, d.bairro ?? null, d.cep ?? null, d.telefone ?? null];
    const propria = (await ctx.db.query<{ id: string }>('select id from core.filial where external_id = $1 and deleted_at is null', [p.external_id])).rows[0];
    const doCodigo = (await ctx.db.query<{ id: string; external_id: string | null }>('select id, external_id from core.filial where codigo = $1 and deleted_at is null', [codigo])).rows[0];
    if (doCodigo && doCodigo.id !== propria?.id && doCodigo.external_id !== null) {
      ctx.log.warn({ external_id: p.external_id }, 'filial do ERP ignorada: o código já pertence a outra filial do ERP');
      return;
    }
    const alvo = propria ?? (doCodigo && doCodigo.external_id === null ? doCodigo : undefined);
    if (alvo) {
      // a padrão adotada por código só ganha a chave do ERP; cidade/UF do ERP completam o que está nulo, sem apagar o do BKO
      await ctx.db.query(
        `update core.filial set external_id = $2, codigo = $3, nome = $4, cidade = coalesce($5, cidade), uf = coalesce($6, uf), ativo = true,
            cnpj = coalesce($7, cnpj), logradouro = coalesce($8, logradouro), numero = coalesce($9, numero), complemento = coalesce($10, complemento),
            bairro = coalesce($11, bairro), cep = coalesce($12, cep), telefone = coalesce($13, telefone)
          where id = $1 and (external_id, codigo, nome, cidade, uf, ativo, cnpj, logradouro, numero, complemento, bairro, cep, telefone) is distinct from
            ($2, $3, $4, coalesce($5, cidade), coalesce($6, uf), true, coalesce($7, cnpj), coalesce($8, logradouro), coalesce($9, numero), coalesce($10, complemento), coalesce($11, bairro), coalesce($12, cep), coalesce($13, telefone))`,
        [alvo.id, p.external_id, codigo, r.nome.trim(), cidade, uf, ...valores],
      );
      return;
    }
    await ctx.db.query('insert into core.filial (tenant_id, external_id, codigo, nome, cidade, uf, cnpj, logradouro, numero, complemento, bairro, cep, telefone, padrao, ativo) values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, true)', [p.external_id, codigo, r.nome.trim(), cidade, uf, ...valores]);
  },
});
