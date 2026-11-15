/**
 * Testes estáticos do banco — rodam SEMPRE (sem Postgres): conferem as migrações SQL, os schemas
 * Drizzle, a fixture dois-tenants e o seed da Fase M contra as regras (CLAUDE.md regra 5, RN-CORE-05).
 */
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERFIS } from '@macuxi/platform-sdk';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { INDICADORES_META, RESULTADOS_VISITA, TIPOS_NOTIFICACAO } from '../../modules/core/contracts/sync';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import * as nuvemGestor from '../../modules/gestor/db/nuvem';
import * as nuvemTreinamento from '../../modules/treinamento/db/nuvem';
import * as nuvemPromotor from '../../modules/promotor/db/nuvem';
import * as nuvemPesquisa from '../../modules/pesquisa/db/nuvem';
import { TABELAS_PESQUISA_DO_GATILHO } from '../seeds/fixtures/pesquisa';
import {
  CODIGOS_ERRO_LINHA,
  CODIGOS_ITEM_DESCARTADO,
  ENTIDADES,
  ESTADOS_LOTE,
  ESTADOS_PEDIDO_ERP,
  ESTADOS_PENDENCIA_INATIVACAO,
  ModoCarga,
  StatusRetornoErp,
  TIPOS_CONECTOR,
  TIPOS_MAPEAMENTO,
} from '../../modules/integracao/contracts';
import { MOTIVOS_APROVACAO, NIVEIS_APROVACAO } from '../../modules/vendedor/domain/aprovacao';
import { ORDER_STATUSES } from '../../modules/vendedor/domain/order';
import { ClienteDoPedido } from '../../modules/vendedor/contracts';
import * as esquemaPlataforma from '../esquema/plataforma';
import { ALCADAS_DEMO, dadosDemo } from '../seeds/demo/demo';
import { dadosFaseM, TENANT_FASE_M } from '../seeds/fase-m/fase-m';
import { dadosDoisTenants, DOIS_TENANTS, ORDEM_TABELAS, PEPPER_HUB_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { carregarFixtureDosTestes, dadosTreinamento, ORDEM_TREINAMENTO } from './fixture-treinamento';
import { COLUNAS_SEM_ESPELHO_DRIZZLE, TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { DADOS_LEGAIS_PUBLICOS, FUNCOES_SA, FUNCOES_SA_0035, FUNCOES_SA_0042, FUNCOES_SA_0058, FUNCOES_SA_0070, FUNCOES_SA_0072, FUNCOES_SA_0073, FUNCOES_WORKER_0072 } from './funcoes-sa';
import { idDeChave, idDeterministico, idFixo, idMedida, idUsuarioPerfil } from '../src/ids';
import { lerMigracoes } from '../src/migrador';
import { PASTA_DB } from '../src/config';
import { hashSenha, verificarSenha } from '../src/senha';

const COMUNS = ['id', 'created_at', 'updated_at', 'deleted_at', 'external_id'];
/** Tabelas do schema integracao (0010, T-0032). */
const TABELAS_INTEGRACAO = [
  'integracao.conector', 'integracao.credencial', 'integracao.politica_versao', 'integracao.sessao_carga', 'integracao.sessao_carga_recebido',
  'integracao.lote', 'integracao.lote_staging', 'integracao.lote_linha_erro', 'integracao.registro_atual', 'integracao.pendencia_inativacao',
  'integracao.inativacao_auditoria', 'integracao.cursor_entidade', 'integracao.reconciliacao', 'integracao.mapeamento', 'integracao.pedido_fila_erp',
  'integracao.pedido_retorno', 'integracao.pedido_retorno_erro',
] as const;
/** Tabelas do schema promotor (0015, T-0056): 9 cadastros de trade (pull) e 11 coletas (push). */
const TABELAS_PROMOTOR = [
  'promotor.categoria_gondola', 'promotor.checklist_loja', 'promotor.mix_obrigatorio', 'promotor.meta_share', 'promotor.concorrente',
  'promotor.produto_concorrente', 'promotor.foto_referencia', 'promotor.tarefa_trade', 'promotor.ponto_extra_negociado',
  'promotor.visita_loja', 'promotor.foto_coleta', 'promotor.checklist_resposta', 'promotor.gondola_registro', 'promotor.medicao_share',
  'promotor.coleta_preco', 'promotor.ruptura_item', 'promotor.validade_item', 'promotor.ponto_extra', 'promotor.acao_concorrencia',
  'promotor.tarefa_execucao',
] as const;
/**
 * Schemas sem espelho Drizzle ainda (fora da comparação Drizzle x SQL). Vazio desde a T-0070: o promotor
 * (modules/promotor/db/nuvem.ts) e a pesquisa (modules/pesquisa/db/nuvem.ts) ganharam espelho e entram na comparação.
 */
const SEM_ESPELHO_DRIZZLE: string[] = [];
/** Tabelas do schema pesquisa (0016, T-0057); resposta_item e resposta_foto são preenchidas pelo gatilho da resposta. */
const TABELAS_PESQUISA = ['pesquisa.questionario', 'pesquisa.questionario_versao', 'pesquisa.resposta', 'pesquisa.resposta_item', 'pesquisa.resposta_foto'] as const;
/** Tabelas novas da 0013 (catálogo, vendedor e core). */
const TABELAS_0013 = [
  'core.produto_unidade', 'core.cliente_endereco', 'catalogo.uso_ia', 'catalogo.catalogo_no', 'catalogo.produto_no', 'catalogo.produto_conteudo',
  'catalogo.produto_atributo', 'catalogo.produto_midia', 'catalogo.sinonimo', 'catalogo.produto_busca', 'catalogo.deposito', 'catalogo.estoque_saldo',
  'catalogo.busca_log', 'vendedor.transportadora', 'vendedor.pedido_faturamento',
] as const;
/** Tabelas do schema gestor (0014, T-0055). */
const TABELAS_GESTOR = ['gestor.evento_aplicado', 'gestor.projecao_fato', 'gestor.alerta', 'gestor.alerta_regra'] as const;
/** Tabelas do schema treinamento (0017, T-0058); detalhes em treinamento.test.ts. */
const TABELAS_TREINAMENTO = [...ORDEM_TREINAMENTO];
/** Tabelas novas da 0018 (T-0063, medidas). */
const TABELAS_0018 = ['core.medida'] as const;
/** Tabelas novas da 0019 (T-0066, notas do ERP; a 0019 também traz core.meta.tipo da T-0065). */
const TABELAS_0019 = ['core.nota_erp'] as const;
/** Tabelas novas da 0020 (T-0071, relacionados do produto; a 0020 também traz o ajuste em R$ de vendedor.pedido e pedido_item). */
const TABELAS_0020 = ['catalogo.produto_relacao'] as const;
/** Tabelas novas da 0028 (T-0082, plano de RV; fora de TABELAS_SYNC: o aparelho não recebe o plano). */
const TABELAS_0028 = ['core.plano_rv'] as const;
/** Tabelas novas da 0033 (T-0085, referência cruzada do produto; a 0033 também traz a aplicação da T-0084). */
const TABELAS_0033 = ['catalogo.produto_referencia'] as const;
/** Tabelas novas da 0035 (T-0087, super-admin de plataforma, ADR 0029): sem tenant_id, só por função (super-admin.test.ts). */
const TABELAS_0035 = ['plataforma.super_admin', 'plataforma.super_admin_desafio', 'plataforma.super_admin_sessao', 'plataforma.auditoria_plataforma'] as const;
/** Tabelas novas da 0039 (T-0093, portal só com e-mail e senha, ADR 0031): sem tenant_id, só por função (portal-email-senha.test.ts). */
const TABELAS_0039 = ['plataforma.portal_tentativa', 'plataforma.portal_sessao', 'plataforma.portal_sessao_empresa'] as const;
/** Tabela nova da 0040 (T-0094, ADR 0032: outbox de e-mail; fora do sync; senha-email-saida.test.ts). */
const TABELAS_0040 = ['plataforma.email_saida'] as const;
/** Tabelas novas da 0041 (T-0111/T-0112, ADR 0033: perfis de acesso; fora do sync; perfis-acesso.test.ts). */
const TABELAS_0041 = ['plataforma.perfil', 'plataforma.perfil_permissao', 'plataforma.usuario_perfil'] as const;
/** Tabelas novas da 0036 (T-0087 fatia E, convite de 1º acesso; fora do sync; usuario-convite.test.ts). */
const TABELAS_0036 = ['core.usuario_convite'] as const;
/** Tabelas novas da 0037 (T-0089, formas e prazos do Vendedor e tabela escalonada do Catálogo; forma-prazo-escalonada.test.ts). */
const TABELAS_0037 = ['vendedor.forma_pagamento', 'vendedor.prazo_pagamento', 'catalogo.tabela_escalonada'] as const;
/** Tabela nova da 0045 (T-0113, ADR 0034: marcas concorrentes no Catálogo, copiadas do Promotor; vai ao aparelho; marca-concorrente.test.ts). */
const TABELAS_0045 = ['catalogo.marca_concorrente'] as const;
/** Tabela nova da 0050 (T-0054, RN-VEN-37: devolução do pedido; fora do sync; pedido-devolucao.test.ts). */
const TABELAS_0050 = ['vendedor.pedido_devolucao'] as const;
/** Tabela nova da 0056 (T-0149, RN-CORE-39, ADR 0040: filial; vai ao aparelho, escopo tenant; filial.test.ts). */
const TABELAS_0056 = ['core.filial'] as const;
/** Tabelas novas da 0057 (T-0147, RN-CORE-38, ADR 0041: tipos e fotos do PDV; vão ao aparelho; foto-pdv.test.ts). */
const TABELAS_0057 = ['core.foto_tipo', 'core.cliente_foto'] as const;
/** Tabela nova da 0058 (T-0158, ADR 0043: diagnóstico do aparelho; fora do sync; diagnostico.test.ts). */
const TABELAS_0058 = ['plataforma.diagnostico'] as const;
/** Tabelas novas da 0064–0066 (T-0170: tarefas, frase do dia, avatar, metas de produtividade e km do dia; t0170-*.db.test.ts). */
const TABELAS_0064_0066 = [
  'core.tarefa', 'core.tarefa_destinatario', 'core.frase_dia', 'core.usuario_avatar', 'core.meta_produtividade', 'core.deslocamento_dia',
] as const;
/** Tabelas novas da 0070 (ADR 0047: catálogo de planos, só por função, e a assinatura do tenant; fora do sync; plano-assinatura.db.test.ts). */
const TABELAS_0070 = ['plataforma.plano', 'plataforma.assinatura'] as const;
/** Tabelas novas da 0072 (ADR 0052: backup, exclusão e empresa excluída; sem tenant_id, só por função; empresa-acoes.db.test.ts). */
const TABELAS_0072 = ['plataforma.backup_empresa', 'plataforma.backup_empresa_parte', 'plataforma.exclusao_empresa', 'plataforma.empresa_excluida'] as const;
/** Tabela nova da 0073 (rodapé legal: dados legais da Macuxi; sem tenant_id, só por função; dados-legais.db.test.ts). */
const TABELAS_0073 = ['plataforma.dados_legais'] as const;
/** Tabelas novas da 0074 (ADR 0054: pacote da primeira carga e pedido de geração; fora do sync; sync-pacote.db.test.ts). */
const TABELAS_0074 = ['plataforma.sync_pacote', 'plataforma.sync_pacote_pedido'] as const;
/** Tabela nova da 0077 (T-0176, RN-CORE-39: filiais de venda do usuário; usuario-filial.db.test.ts). */
const TABELAS_0077 = ['core.usuario_filial'] as const;
/** Tabelas novas da 0079 (T-0174, ADR 0058: fotos em lote por ZIP e trabalho sob demanda; fora do sync; foto-lote.db.test.ts). */
const TABELAS_0079 = ['plataforma.trabalho', 'catalogo.foto_lote', 'catalogo.foto_lote_item'] as const;
/** Tabela nova da 0080 (T-0175, RN-CORE-59: contador do Código FDV por tenant; fora do sync; usuario-codigo-fdv.db.test.ts). */
const TABELAS_0080 = ['core.usuario_codigo_fdv_contador'] as const;
/** Tabela nova da 0081 (T-0180, ADR 0059 §5: último contato do aparelho por usuário; fora do sync; almoco-alerta-produtividade.db.test.ts). */
const TABELAS_0081 = ['core.usuario_contato'] as const;
const migracoes = lerMigracoes();
const sqlUp = migracoes.map((m) => m.up).join('\n');

/** Blocos `create table x.y ( ... );` das migrações up, mais as colunas de `alter table x.y add column` posteriores. */
function tabelasCriadas(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const m of /create table (?:if not exists )?([a-z_]+\.[a-z_]+) \(([\s\S]*?)\n\);/g[Symbol.matchAll](sqlUp)) mapa.set(m[1]!, m[2]!);
  for (const m of /^alter table ([a-z_]+\.[a-z_]+) add column (?:if not exists )?([a-z_]+) ([a-z][^;]*);/gm[Symbol.matchAll](sqlUp)) {
    mapa.set(m[1]!, `${mapa.get(m[1]!) ?? ''}\n  ${m[2]!} ${m[3]!}`);
  }
  return mapa;
}

function tabelasDrizzle(): Map<string, ReturnType<typeof getTableConfig>> {
  const mapa = new Map<string, ReturnType<typeof getTableConfig>>();
  for (const v of [...Object.values(esquemaPlataforma), ...Object.values(nuvemCore), ...Object.values(nuvemCatalogo), ...Object.values(nuvemVendedor), ...Object.values(nuvemIntegracao), ...Object.values(nuvemGestor), ...Object.values(nuvemTreinamento), ...Object.values(nuvemPromotor), ...Object.values(nuvemPesquisa)]) {
    if (v instanceof PgTable) {
      const cfg = getTableConfig(v);
      mapa.set(`${cfg.schema}.${cfg.name}`, cfg);
    }
  }
  return mapa;
}

const escapar = (s: string) => s.replace(/\./g, '\\.');

describe('migrações (estático)', () => {
  it('toda migração tem up e down, numeração contínua', () => {
    // lerMigracoes já recusa buraco e par incompleto; aqui: as 13 primeiras (até a 0013), a 0014 do Gestor (T-0055), a 0015 do Promotor (T-0056), a 0016 da Pesquisa (T-0057), a 0017 do Treinamento (T-0058) e a 0018 das medidas (T-0063) no lugar certo
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[13]).toBe('0014_gestor');
    expect(nomes[14]).toBe('0015_promotor');
    expect(nomes[15]).toBe('0016_pesquisa');
    expect(nomes[16]).toBe('0017_treinamento');
    expect(nomes[17]).toBe('0018_medidas');
    expect(nomes[18]).toBe('0019_core_nota_erp_meta_tipo');
    expect(nomes[19]).toBe('0020_pedido_ajuste_valor_produto_relacao');
    expect(nomes[20]).toBe('0021_core_recado_do_dia'); // T-0073: colunas novas em core.notificacao e core.indicador_diario.clientes_positivados (recado-do-dia.test.ts)
    expect(nomes[21]).toBe('0022_plataforma_geracao_base'); // T-0079: plataforma.tenant.geracao_base e girar_geracao_base (geracao-base.test.ts)
    expect(nomes[22]).toBe('0023_core_positivacao_mes'); // positivação acumulada do mês: indicador_diario.clientes_positivados_ids e core.positivacao_do_mes (positivacao-mes.test.ts)
    expect(nomes[23]).toBe('0024_plataforma_resumo_outbox_lgpd'); // T-0078: resumo_outbox (/v1/saude), anonimização e exclusão de tenant (lgpd-outbox.test.ts)
    expect(nomes[24]).toBe('0025_core_nota_erp_vendedor'); // T-0080: core.nota_erp.vendedor_external_id e usuario_id, 2 índices (nota-erp-vendedor.test.ts)
    expect(nomes[25]).toBe('0026_core_visita_etapa_pendente'); // T-0039 §2: visita_etapa 'pendente' + 4 colunas e visita.etapas_pendentes, 2 índices parciais (visita-etapa-pendente.test.ts)
    expect(nomes[26]).toBe('0027_plataforma_tenants_ativos'); // T-0039 §2.3 (ADR 0022): plataforma.tenants_ativos() só ao macuxi_worker (tenants-ativos.test.ts)
    expect(nomes[27]).toBe('0028_core_plano_rv'); // T-0082: core.plano_rv (RN-CORE-30), regras em jsonb, RLS forçado (plano-rv.test.ts)
    expect(nomes[28]).toBe('0029_plataforma_provisionar_tenant'); // T-0083: plataforma.provisionar_tenant(jsonb), só a conexão de administração (provisionar-tenant.test.ts)
    expect(nomes[29]).toBe('0030_core_notificacao_subtipo'); // T-0039: core.notificacao.subtipo (text nulo, CHECK de formato, sem índice) e backfill do alerta (notificacao-subtipo.test.ts)
    expect(nomes[30]).toBe('0031_plataforma_manutencao'); // T-0075 B1 (ADR 0024): papel macuxi_manutencao e política manutencao em toda tabela com RLS (conformidade.test.ts)
    expect(nomes[31]).toBe('0032_plataforma_excluir_tenant_ordem_fk'); // T-0075 B2 (ADR 0024): excluir_tenant em ordem de FK, sem session_replication_role (lgpd-outbox.test.ts)
    expect(nomes[32]).toBe('0033_catalogo_aplicacao_referencia'); // T-0084/T-0085: aplicação (teto 2.000, peso C na busca, retrato no item) e catalogo.produto_referencia (aplicacao-referencia.test.ts)
    expect(nomes[33]).toBe('0034_catalogo_referencia_marca_nome'); // T-0085 (ADR 0027, risco 2): produto_referencia.marca_nome, retrato nulo do nome da marca, CHECK 1..120, sem backfill (referencia-marca-nome.test.ts)
    expect(nomes[34]).toBe('0035_plataforma_super_admin'); // T-0087 (ADR 0029): super-admin fora dos tenants, funções sa_*, auditoria append-only, provisionar_tenant sem admin e com parâmetros (super-admin.test.ts)
    expect(nomes[36]).toBe('0037_forma_prazo_escalonada'); // T-0089: forma_pagamento e prazo_pagamento (Vendedor), pagamento do pedido, formas e prazo médio do cliente (Core), tabela_escalonada (Catálogo) e a forma "À vista" semeada (forma-prazo-escalonada.test.ts)
    expect(nomes[35]).toBe('0036_core_usuario_convite'); // T-0087 fatia E (RN-CORE-31): core.usuario_convite (só o hash do token, uso único, sem DEFINER), core.usuario.telefone e anonimizar_usuario com convites (usuario-convite.test.ts)
    expect(nomes[37]).toBe('0038_plataforma_papel_portal'); // T-0091 (ADR 0029): papel macuxi_portal, EXECUTE das 20 sa_* só a ele, macuxi_app e macuxi_worker sem (papel-portal.test.ts)
    expect(nomes[38]).toBe('0039_plataforma_portal_email_senha'); // T-0093 (ADR 0031): login do portal só com e-mail e senha, bloqueio por chave, sessão por empresa, criar_super_admin; saem 14 sa_* (portal-email-senha.test.ts)
    expect(nomes[39]).toBe('0040_core_senha_email_saida'); // T-0094 (ADR 0032): estado da senha e sessao_versao em core.usuario, outbox de e-mail, portal com a versão (senha-email-saida.test.ts)
    expect(nomes[41]).toBe('0042_plataforma_portal_redefinir_senha_admin'); // T-0094 (padrão de fábrica da T-0111): super-admin lista os admins da empresa e redefine a senha do admin pelo portal, com o e-mail na outbox (portal-redefinir-senha.test.ts)
    expect(nomes[42]).toBe('0043_integracao_cancelamento_erp'); // T-0114: conector.aceita_cancelamento e pedido_fila_erp.cancelamento_* com CHECKs e índice do poll (cancelamento-erp.test.ts)
    expect(nomes[43]).toBe('0044_treinamento_xp_referencia'); // T-0106: xp_lancamento.referencia_id 1..160 e único (tenant_id, id); a chave natural da 0017 fica total (xp-referencia.test.ts)
    expect(nomes[44]).toBe('0045_catalogo_marca_concorrente'); // T-0113 (ADR 0034): catalogo.marca_concorrente copiada de promotor.concorrente (mesmos ids), FK da referência, Promotor só leitura (marca-concorrente.test.ts)
    expect(nomes[45]).toBe('0046_plataforma_portal_multiperfil'); // D-MP2 (T-0094/T-0111): o portal pelos perfis do usuário (todos de base admin + acesso.portal), usuario_entra_no_portal e as 4 sa_* do login (portal-multiperfil.test.ts)
    expect(nomes[46]).toBe('0047_plataforma_portal_admin_multiperfil'); // resto do D-MP2 (T-0094/T-0111): sa_admins_da_empresa e sa_redefinir_senha_admin pela soma dos perfis de base admin (usuario_tem_perfil_admin), lista com entra_no_portal (portal-admin-multiperfil.test.ts)
    expect(nomes[47]).toBe('0048_integracao_cancelamento_recusado'); // T-0114: pedido_fila_erp.cancelamento_recusado_em e cancelamento_recusa_motivo, estado 'recusado' nos CHECKs e índice do monitor (cancelamento-recusado.test.ts)
    expect(nomes[48]).toBe('0049_plataforma_conferencias_no_commit_definer'); // R-20261108-130423-testes: as 4 conferências adiáveis da 0041 SECURITY DEFINER (o COMMIT do portal não dá 42501) (conferencias-no-commit.test.ts)
    expect(nomes[49]).toBe('0050_vendedor_pedido_devolucao'); // T-0054 (RN-VEN-37): vendedor.pedido_devolucao, uma linha viva por nota de devolução do ERP, fora do sync (pedido-devolucao.test.ts)
    expect(nomes[50]).toBe('0051_plataforma_perfil_assistente'); // RD-0014 (T-0111): semear_perfis_fabrica com 'Assistente' e o nome dos tenants que já existem (perfil-assistente.test.ts)
    expect(nomes[51]).toBe('0052_plataforma_tenant_por_codigo_minimo'); // T-0122 N5: tenant_por_codigo só (id, status), tenant_da_sessao() e os CHECKs de evento iguais ao EVENTO_RE (tenant-por-codigo-minimo.test.ts)
    expect(nomes[52]).toBe('0053_core_cliente_canal'); // T-0115 (RN-PES-05): core.cliente.canal (1..60, nulo) e índice parcial (tenant_id, canal) (cliente-canal.test.ts)
    expect(nomes[53]).toBe('0054_integracao_mapeamento_canal'); // T-0115 (RN-PES-05): CHECK mapeamento_tipo_valido com 'canal' = TIPOS_MAPEAMENTO (mapeamento-canal.test.ts)
    expect(nomes[55]).toBe('0056_core_filial'); // T-0149 (RN-CORE-39, ADR 0040): core.filial com a padrão semeada, cliente/depósito/item de preço com filial_id, faixa e pedido com filial, entidade filial no Hub (filial.test.ts)
    expect(nomes[56]).toBe('0057_core_foto_pdv'); // T-0147 (RN-CORE-38, ADR 0041): core.foto_tipo com a Fachada semeada, core.cliente_foto, cliente.inativado_em e arquivo.perfis_leitura (foto-pdv.test.ts)
    expect(nomes[57]).toBe('0058_plataforma_diagnostico'); // T-0158 (ADR 0043): plataforma.diagnostico com protocolo global, RLS, app só insere/lê, worker só alerta_*, sa_listar_diagnosticos/sa_diagnostico e expurgar_diagnosticos (diagnostico.test.ts)
    expect(nomes[62]).toBe('0063_core_usuario_limite_desconto'); // T-0168 (RN-VEN-11a): core.usuario.desconto_limita_item (true), desconto_limita_pedido (false) e desconto_maximo_pedido_permil (0..1000, ‰) com 2 CHECKs (usuario-limite-desconto.db.test.ts)
    expect(nomes[63]).toBe('0064_core_tarefa'); // T-0170 (RN-CORE-TAR-01..12): core.tarefa e core.tarefa_destinatario, gatilho tarefa_tocar_destinatarios e core.notificacao.tarefa_id (t0170-tarefa.db.test.ts)
    expect(nomes[64]).toBe('0065_core_frase_avatar'); // T-0170 (RN-CORE-41 e RN-CORE-42): core.frase_dia com as 30 padrão pelo gatilho do tenant e core.usuario_avatar (t0170-frase-avatar.db.test.ts)
    expect(nomes[65]).toBe('0066_core_meta_produtividade'); // T-0170: core.meta_produtividade, core.deslocamento_dia e 'itens_por_pedido' no CHECK de core.meta.indicador (t0170-meta-produtividade.db.test.ts)
    expect(nomes[66]).toBe('0067_core_cliente_visita_resumo'); // Oficial (14/11): view core.v_cliente_visita_resumo (security_invoker, só select ao app) e 2 índices em core.visita (cliente-visita-resumo.db.test.ts)
    expect(nomes[67]).toBe('0068_plataforma_tenant_numero_licenca'); // R-20261114-130500/131200/131500: código da licença UF + 4 dígitos aleatórios (CHECK aceita os legados ou ^UF[0-9]{4}$), provisionar_tenant sem codigo sorteia pela uf e é idempotente pelo id do chamador, atribuir_codigo_licenca (tenant-numero-licenca.db.test.ts)
    expect(nomes[68]).toBe('0069_core_cargo_hierarquia'); // decisão do dono (14/11): plataforma.perfil.cargo (5 da plataforma, com promotor), gerente obrigatório do promotor (gatilhos adiados), um perfil vivo por usuário (exclusão adiada) e view core.v_usuario_hierarquia (cargo-hierarquia.db.test.ts)
    expect(nomes[73]).toBe('0074_plataforma_sync_pacote'); // ADR 0054 (pacote da primeira carga): plataforma.sync_pacote e sync_pacote_pedido (app lê e pede, worker gera), fora do sync, e índice por filial em catalogo.tabela_preco_item (sync-pacote.db.test.ts)
    expect(nomes[74]).toBe('0075_catalogo_referencia_marca_opcional'); // R-20261115-073000 (item 3, RN-CAT-09): catalogo.produto_referencia.marca_id nula e único vivo por (tenant, produto, codigo_compacto); repetidas no produto ficam na menor ordem (referencia-marca-opcional.db.test.ts)
    expect(nomes[76]).toBe('0077_core_usuario_filial'); // T-0176 (RN-CORE-39, R-20261115-094500): core.usuario.filial_cadastro_id e core.usuario_filial (filiais de venda), cadastro entre as de venda (gatilho adiado usuario_filial_inclui_cadastro), backfill da empresa com uma filial (usuario-filial.db.test.ts)
    expect(nomes[78]).toBe('0079_catalogo_foto_lote'); // T-0174 (RN-CAT-14, ADR 0058): plataforma.trabalho e as 3 funções do worker, catalogo.foto_lote e foto_lote_item, produto_midia.hash_conteudo e ordem da principal = 1, arquivo com PNG/WEBP/ZIP (foto-lote.db.test.ts)
    expect(nomes[80]).toBe('0081_core_almoco_gestor_alerta_produtividade'); // T-0180 (D3–D5, RN-CORE-44): core.usuario.almoco_inicio_min/almoco_fim_min (nulas = padrão da empresa), parado_entre_visitas e sem_checkin_inicio no alerta_tipo_valido e core.usuario_contato (último contato do aparelho, fora do sync) (almoco-alerta-produtividade.db.test.ts)
    expect(nomes[61]).toBe('0062_core_catalogo_erp_ordem'); // T-0095 (RN-INT-02/04): erp_alterado_em em mais 9 tabelas do Core e do Catálogo, desligado_no_bko_em em filial e tabela_preco, gatilhos <tabela>_versao_erp e <tabela>_desligado_no_bko e 5 índices da maior versão (erp-ordem.test.ts)
    expect(nomes[60]).toBe('0061_vendedor_reserva_filial'); // T-0149 (RN-VEN-20): vendedor.pedido_item.filial_id derivada do pedido por gatilho e índice da reserva por (tenant, produto, filial) (reserva-filial.test.ts)
    expect(nomes[59]).toBe('0060_vendedor_pedido_item_marca'); // T-0159: vendedor.pedido_item.marca, retrato nulo 1..100 da marca do produto (pedido-item-marca.test.ts)
    expect(nomes[58]).toBe('0059_core_filial_dados_fiscais'); // T-0159: cnpj, endereço e telefone NULOS em core.filial, CHECKs de formato e único vivo do CNPJ (filial-dados-fiscais.test.ts)
    expect(nomes[54]).toBe('0055_vendedor_endereco_editado'); // T-0141 C (RN-VEN-17): 3 CHECKs do retrato endereco_entrega com origem 'erp'|'editado', sem coluna nova (pedido-endereco-editado.test.ts)
    expect(nomes.slice(0, 13)).toEqual([
      '0001_plataforma', '0002_core', '0003_plataforma_worker', '0004_core_sessao', '0005_plataforma_arquivo', '0006_core_lote_a', '0007_vendedor_pedido',
      '0008_catalogo_preco', '0009_vendedor_pedido_completo', '0010_integracao', '0011_plataforma_outbox_retencao',
      '0012_search_path_pg_temp', '0013_catalogo_vendedor_prevenda',
    ]);
    expect(migracoes.map((m) => m.versao)).toEqual(migracoes.map((_, i) => String(i + 1).padStart(4, '0')));
  });

  it('down de cada migração remove os schemas que o up cria', () => {
    for (const m of migracoes) {
      for (const [, schema] of m.up.matchAll(/^create schema ([a-z_]+);/gm)) {
        expect(m.down, `${m.versao} deveria remover o schema ${schema}`).toMatch(new RegExp(`drop schema if exists ${schema} cascade`));
      }
    }
  });

  const criadas = tabelasCriadas();
  it('cria as tabelas pedidas na T-0002, na T-0003 F2 (sessao, dispositivo), na Sprint 1 (lote A, arquivo, vendedor mínimo), na T-0029, na T-0032, na T-0055, na T-0056 e na T-0057', () => {
    expect([...criadas.keys()].sort()).toEqual(
      [
        'plataforma.tenant', 'plataforma.tenant_modulo', 'plataforma.perfil_modulo', 'plataforma.usuario_modulo',
        'plataforma.evento', 'plataforma.evento_consumo', 'plataforma.parametro', 'plataforma.auditoria',
        'core.usuario', 'core.equipe', 'core.produto', 'core.cliente', 'core.carteira', 'core.sessao', 'core.dispositivo',
        'plataforma.arquivo',
        'core.cliente_contato', 'core.cliente_financeiro', 'core.titulo', 'core.historico_compra', 'core.motivo', 'core.rota', 'core.rota_parada',
        'core.visita', 'core.visita_etapa', 'core.notificacao', 'core.meta', 'core.indicador_diario',
        'vendedor.pedido', 'vendedor.pedido_item',
        'catalogo.tabela_preco', 'catalogo.tabela_preco_item', 'catalogo.cliente_tabela_preco',
        'vendedor.pedido_evento', 'vendedor.condicao_pagamento', 'vendedor.cliente_condicao', 'vendedor.numeracao_pedido',
        ...TABELAS_INTEGRACAO,
        ...TABELAS_0013,
        ...TABELAS_GESTOR,
        ...TABELAS_0018,
        ...TABELAS_0019,
        ...TABELAS_0020,
        ...TABELAS_0028,
        ...TABELAS_0033,
        ...TABELAS_0035,
        ...TABELAS_0036,
        ...TABELAS_0037,
        ...TABELAS_0039,
        ...TABELAS_0040,
        ...TABELAS_0041,
        ...TABELAS_0045,
        ...TABELAS_0050,
        ...TABELAS_0056,
        ...TABELAS_0057,
        ...TABELAS_0058,
        ...TABELAS_0064_0066,
        ...TABELAS_0070,
        ...TABELAS_0072,
        ...TABELAS_0073,
        ...TABELAS_0074,
        ...TABELAS_0077,
        ...TABELAS_0079,
        ...TABELAS_0080,
        ...TABELAS_0081,
        ...TABELAS_PROMOTOR,
        ...TABELAS_PESQUISA,
        ...TABELAS_TREINAMENTO,
      ].sort(),
    );
  });

  for (const [tabela, corpo] of criadas) {
    it(`S0-023 ${tabela}: campos comuns, RLS ligado e forçado, política, grant e índice de sync`, () => {
      for (const col of COMUNS) expect(corpo, `${tabela}.${col}`).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
      expect(corpo).toMatch(/^\s+id\s+uuid primary key/m);
      if ((TABELAS_SO_POR_FUNCAO as readonly string[]).includes(tabela)) {
        // 0035 (ADR 0029): sem tenant_id, sem política e sem grant para app/worker; só a manutencao e as funções sa_*
        expect(tabela in TABELAS_SEM_TENANT_ID).toBe(true);
        expect(corpo).not.toMatch(/^\s+tenant_id\s/m);
        expect(sqlUp).not.toMatch(new RegExp(`create policy [a-z_]+ on ${escapar(tabela)} for [a-z]+ to macuxi_(app|worker)`));
        expect(sqlUp).not.toMatch(new RegExp(`grant [a-z, ()_]+ on ${escapar(tabela)} to`));
        expect(sqlUp).toContain(`revoke all on ${tabela} from public, macuxi_app, macuxi_worker;`);
        expect(sqlUp).toContain(`create policy manutencao on ${tabela} for all to macuxi_manutencao using (true) with check (true);`);
        expect(sqlUp).toContain(`alter table ${tabela} enable row level security;`);
        expect(sqlUp).toContain(`alter table ${tabela} force row level security;`);
        return;
      }
      if (!(tabela in TABELAS_SEM_TENANT_ID)) {
        expect(corpo).toMatch(/^\s+tenant_id\s+uuid not null references plataforma\.tenant \(id\)/m);
        expect(sqlUp).toMatch(new RegExp(`create policy isolamento_tenant on ${escapar(tabela)} for all to macuxi_app\\s+using \\(tenant_id = plataforma\\.tenant_atual\\(\\)\\)\\s+with check \\(tenant_id = plataforma\\.tenant_atual\\(\\)\\)`));
      } else {
        expect(sqlUp).toMatch(new RegExp(`create policy isolamento_tenant on ${escapar(tabela)} for all to macuxi_app`));
      }
      expect(sqlUp).toContain(`alter table ${tabela} enable row level security;`);
      expect(sqlUp).toContain(`alter table ${tabela} force row level security;`);
      expect(sqlUp).toMatch(new RegExp(`grant [a-z, ]+ on ${escapar(tabela)} to macuxi_app;`));
      const foraDoSync = (TABELAS_FORA_DO_SYNC as readonly string[]).includes(tabela) || tabela in TABELAS_SEM_TENANT_ID;
      if (!foraDoSync) expect(sqlUp).toMatch(new RegExp(`on ${escapar(tabela)} \\(tenant_id, updated_at, id\\)`));
    });
  }

  it('auditoria: aplicação só lê e insere (RN-AUD-01)', () => {
    expect(sqlUp).toContain('grant select, insert on plataforma.auditoria to macuxi_app;');
  });

  it('contexto de tenant falha fechado: tenant_atual() devolve NULL sem app.tenant_id', () => {
    expect(sqlUp).toContain("nullif(current_setting('app.tenant_id', true), '')::uuid");
    const semComentarios = sqlUp.replace(/--.*$/gm, '');
    expect(semComentarios.match(/(?<!no)bypassrls/gi)).toBeNull();
    expect(sqlUp).toMatch(/create role macuxi_app nologin nosuperuser nobypassrls/);
  });
});

describe('0003 macuxi_worker (estático, ADR 0007)', () => {
  const m = migracoes.find((x) => x.versao === '0003')!;
  const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

  it('papel sem BYPASSRLS e políticas despacho_outbox só para macuxi_worker', () => {
    expect(m.up).toMatch(/create role macuxi_worker nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;/);
    expect(m.up).toMatch(/create policy despacho_outbox on plataforma\.evento for select to macuxi_worker\s+using \(true\);/);
    expect(m.up).toMatch(/create policy despacho_outbox_marcar on plataforma\.evento for update to macuxi_worker\s+using \(true\) with check \(true\);/);
  });

  it('grants do worker: usage em plataforma, colunas de plataforma.evento e só EXECUTE nas funções de expurgo (0010, 0011) e em tenants_ativos (0027)', () => {
    const grants = [...semComentarios(sqlUp).matchAll(/grant ([^;]*?) to macuxi_worker;/g)].map((g) => g[1]!.replace(/\s+/g, ' '));
    expect(grants).toEqual([
      'usage on schema plataforma',
      'select (id, tenant_id, nome, modulo, agregado_id, payload, ocorrido_em, publicado_em, tentativas, usuario_id, request_id) on plataforma.evento',
      'update (publicado_em, tentativas, ultimo_erro) on plataforma.evento',
      'usage on schema integracao',
      'execute on function integracao.expurgar_retencao(timestamptz, integer)',
      'execute on function plataforma.expurgar_outbox(timestamptz, integer)',
      'execute on function plataforma.tenants_ativos()', // 0027 (T-0039, ADR 0022): agendador das tarefas periódicas
      'select on plataforma.email_saida', // 0040 (T-0094, ADR 0032): despachante da outbox de e-mail
      'update (carga, tentativas, proxima_tentativa_em, enviado_em, falhou_em, ultimo_erro) on plataforma.email_saida',
      // 0058 (T-0158, ADR 0043): alerta do diagnóstico (sem descricao e detalhe) e expurgo de 90 dias
      'select (id, tenant_id, protocolo, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante, aparelho_modelo, android, android_api, tela, motivo, print_id, ocorrido_em, recebido_em, alerta_situacao, alerta_tentativas, alerta_proxima_em, alerta_recado_id, alerta_em) on plataforma.diagnostico',
      'update (alerta_situacao, alerta_tentativas, alerta_proxima_em, alerta_recado_id, alerta_em) on plataforma.diagnostico',
      'execute on function plataforma.expurgar_diagnosticos(timestamptz, integer)',
      // 0072 (ADR 0052): política do despachante e do e-mail (tenant ativo) e o job de backup e de exclusão da empresa
      ...FUNCOES_WORKER_0072.map((f) => `execute on function ${f}`),
      // 0074 (ADR 0054): gerador de pacotes da primeira carga
      'select on plataforma.sync_pacote',
      'insert (id, tenant_id, modulo, particao, filial_id, formato, horizonte, geracao_base, chave_armazenamento, bytes, md5, entidades) on plataforma.sync_pacote',
      'update (situacao, substituido_em, arquivo_apagado_em, deleted_at) on plataforma.sync_pacote',
      'delete on plataforma.sync_pacote',
      'select on plataforma.sync_pacote_pedido',
      'insert (id, tenant_id, modulo, particao, filial_id, origem, gerar_apos) on plataforma.sync_pacote_pedido',
      'update (situacao, gerar_apos, tentativas, ultimo_erro, atendido_em, deleted_at) on plataforma.sync_pacote_pedido',
      'delete on plataforma.sync_pacote_pedido',
      // 0079 (T-0174, ADR 0058): o laço de trabalhos sob demanda (só as funções; nenhuma tabela)
      'execute on function plataforma.trabalho_reservar(text, integer)',
      'execute on function plataforma.trabalho_devolver(uuid, text, text, text, integer)',
      'execute on function plataforma.trabalho_renovar(uuid, text, integer)',
    ]);
  });

  it('carteira_usuario_sync_ix sem filtro de deleted_at (o pull devolve removidos)', () => {
    expect(m.up).toMatch(/create index carteira_usuario_sync_ix on core\.carteira \(tenant_id, usuario_id, updated_at, id\);/);
  });

  it('down desfaz tudo o que o up cria', () => {
    for (const trecho of [
      'drop index if exists core.carteira_usuario_sync_ix;',
      'drop table if exists plataforma.evento_consumo;',
      'drop policy if exists despacho_outbox_marcar on plataforma.evento;',
      'drop policy if exists despacho_outbox on plataforma.evento;',
      'revoke all on plataforma.evento from macuxi_worker;',
      'drop index if exists plataforma.evento_tenant_id_uk;',
      'alter table plataforma.evento drop column if exists request_id;',
      'alter table plataforma.evento drop column if exists usuario_id;',
      'revoke usage on schema plataforma from macuxi_worker;',
    ]) expect(m.down).toContain(trecho);
  });
});

describe('0031 papel de manutenção (estático, T-0075 B1, ADR 0024)', () => {
  const m31 = migracoes.find((x) => x.versao === '0031')!;
  const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

  it('papel NOLOGIN sem BYPASSRLS, herdado só pelo migrador (current_user, WITH INHERIT TRUE), com trava contra app/worker', () => {
    const sql = semComentarios(m31.up);
    expect(sql).toContain('create role macuxi_manutencao nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;');
    expect(sql).toContain('grant macuxi_manutencao to current_user with inherit true;');
    expect(sql).toContain("pg_has_role(v_papel, 'macuxi_manutencao', 'MEMBER')");
    expect(sql).toContain("array['macuxi_app', 'macuxi_worker']");
    expect(sql).toMatch(/errcode = '42501'/);
  });

  it('política manutencao em toda tabela com RLS (laço no catálogo): for all to macuxi_manutencao using (true) with check (true)', () => {
    const sql = semComentarios(m31.up);
    expect(sql).toContain("execute format('create policy manutencao on %s for all to macuxi_manutencao using (true) with check (true)', v_t.tabela);");
    expect(sql).toMatch(/where c\.relkind in \('r', 'p'\) and c\.relrowsecurity/);
    expect(sql).toContain("not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'manutencao')");
  });

  it('nenhuma migração concede macuxi_manutencao a outro papel que não o migrador, nem dá política a ele fora do padrão', () => {
    const tudo = semComentarios(sqlUp);
    expect([...tudo.matchAll(/grant macuxi_manutencao to ([a-z_]+)/g)].map((x) => x[1])).toEqual(['current_user']);
    expect(tudo).not.toMatch(/grant [a-z_, ]*macuxi_manutencao[a-z_, ]* to macuxi_(app|worker)/);
    for (const [, corpo] of tudo.matchAll(/create policy manutencao on ([^;]+);/g)) {
      expect(corpo).toMatch(/^(%s|[a-z_]+\.[a-z_]+) for all to macuxi_manutencao using \(true\) with check \(true\)'?(, v_t\.tabela\))?$/);
    }
  });

  it('regra para tabela nova (0032+): toda create table leva a política manutencao na mesma migração', () => {
    for (const m of migracoes.filter((x) => x.versao > '0031')) {
      for (const [, tabela] of m.up.matchAll(/create table (?:if not exists )?([a-z_]+\.[a-z_]+) \(/g)) {
        expect(m.up, `${m.versao}: ${tabela} sem a política manutencao (0031)`).toContain(
          `create policy manutencao on ${tabela} for all to macuxi_manutencao using (true) with check (true);`,
        );
      }
    }
  });

  it('down apaga só as políticas manutencao; o papel e a filiação ficam (objetos do cluster, como o macuxi_worker)', () => {
    const sql = semComentarios(m31.down);
    expect(sql).toContain("where p.polname = 'manutencao'");
    expect(sql).toContain("execute format('drop policy if exists manutencao on %s', v_t.tabela);");
    expect(sql).not.toMatch(/drop role|revoke/);
  });
});

describe('0004 core.sessao / core.dispositivo / tentativas (estático, T-0003 F2)', () => {
  const m = migracoes.find((x) => x.versao === '0004')!;
  const criadas = tabelasCriadas();

  it('core.usuario ganha tentativas_falhas (not null default 0, >= 0) e bloqueio_ate', () => {
    expect(m.up).toContain('alter table core.usuario add column tentativas_falhas smallint not null default 0;');
    expect(m.up).toContain('alter table core.usuario add column bloqueio_ate timestamptz;');
    expect(m.up).toContain('check (tentativas_falhas >= 0)');
  });

  it('FKs compostas por tenant (usuário e aparelho do MESMO tenant) e hash sha256 hex', () => {
    expect(criadas.get('core.dispositivo')).toContain('foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(criadas.get('core.sessao')).toContain('foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(criadas.get('core.sessao')).toContain('foreign key (tenant_id, dispositivo_id) references core.dispositivo (tenant_id, id)');
    expect(criadas.get('core.sessao')).toContain("check (token_hash ~ '^[0-9a-f]{64}$')");
  });

  it('índices das consultas do repositório do Core (modules/core/api/repositorio.ts)', () => {
    for (const idx of [
      'create unique index sessao_token_uk on core.sessao (tenant_id, token_hash);',
      'create index sessao_usuario_ativa_ix on core.sessao (tenant_id, usuario_id) where revogado_em is null;',
      'create index sessao_familia_ix on core.sessao (tenant_id, familia_id);',
      'create index dispositivo_usuario_ix on core.dispositivo (tenant_id, usuario_id);',
      'create index equipe_responsavel_ix on core.equipe (tenant_id, responsavel_id);',
    ]) expect(m.up).toContain(idx);
  });

  it('sessao e dispositivo ficam fora do sync (nunca vão ao aparelho)', () => {
    expect(TABELAS_FORA_DO_SYNC).toEqual(expect.arrayContaining(['core.sessao', 'core.dispositivo']));
  });

  it('down desfaz tudo o que o up cria (sessao antes de dispositivo, por causa da FK)', () => {
    for (const trecho of [
      'drop index if exists core.equipe_responsavel_ix;',
      'drop table if exists core.sessao;',
      'drop table if exists core.dispositivo;',
      'alter table core.usuario drop constraint if exists usuario_tentativas_nao_negativas;',
      'alter table core.usuario drop column if exists bloqueio_ate;',
      'alter table core.usuario drop column if exists tentativas_falhas;',
    ]) expect(m.down).toContain(trecho);
    expect(m.down.indexOf('drop table if exists core.sessao;')).toBeLessThan(m.down.indexOf('drop table if exists core.dispositivo;'));
  });
});

describe('Sprint 1: 0005 arquivo, 0006 lote A do core, 0007 vendedor mínimo (estático, desenho T-0016 §7)', () => {
  const m5 = migracoes.find((x) => x.versao === '0005')!;
  const m6 = migracoes.find((x) => x.versao === '0006')!;
  const m7 = migracoes.find((x) => x.versao === '0007')!;
  const criadas = tabelasCriadas();
  /** Valores de um `check (col in ('a', 'b'))` (ou `col is null or col in (...)`) no corpo da tabela. */
  const valoresDoCheck = (tabela: string, coluna: string): string[] => {
    const m = new RegExp(`check \\((?:${coluna} is null or )?${coluna} in \\(([^)]*)\\)\\)`).exec(criadas.get(tabela) ?? '');
    return m ? [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!) : [];
  };

  it('RN-CORE-11: único parcial de visita aberta por usuário (checkout nulo e viva) e checkout_id único', () => {
    expect(m6.up).toContain('create unique index visita_aberta_uk on core.visita (tenant_id, usuario_id) where checkout_em is null and deleted_at is null;');
    expect(m6.up).toContain('create unique index visita_checkout_uk on core.visita (tenant_id, checkout_id) where checkout_id is not null;');
  });

  it('RN-CORE-10 e RN-CORE-14: checks da visita (justificativa fora do raio; cliente fechado com motivo e foto)', () => {
    const v = criadas.get('core.visita')!;
    expect(v).toContain("check (not fora_do_raio or nullif(btrim(justificativa_fora_raio), '') is not null)");
    expect(v).toContain("check (resultado is distinct from 'cliente_fechado' or (motivo_id is not null and foto_fachada_id is not null))");
    expect(v).toContain('check (checkout_em is null or checkout_em >= checkin_em)');
    expect(v).toContain('foreign key (tenant_id, foto_fachada_id) references plataforma.arquivo (tenant_id, id)');
    expect(v).not.toMatch(/pedido_id[^\n]*references/);
  });

  it('listas fechadas do banco = contratos (core: resultado, tipo de notificação, indicador de meta; vendedor: status)', () => {
    expect(valoresDoCheck('core.visita', 'resultado')).toEqual([...RESULTADOS_VISITA, 'nao_finalizado']);
    expect([...nuvemCore.RESULTADOS_VISITA_BANCO]).toEqual([...RESULTADOS_VISITA, 'nao_finalizado']);
    expect(valoresDoCheck('core.notificacao', 'tipo')).toEqual([...TIPOS_NOTIFICACAO]);
    expect([...nuvemCore.TIPOS_NOTIFICACAO_BANCO]).toEqual([...TIPOS_NOTIFICACAO]);
    // core.meta.indicador: vale o ÚLTIMO CHECK meta_indicador_valido (a 0066, T-0170, o recria com 'itens_por_pedido').
    const recriados = [...sqlUp.matchAll(/alter table core\.meta add constraint meta_indicador_valido\s+check \(indicador in \(([^)]*)\)\)/g)];
    const checkMeta = recriados.length
      ? [...recriados.at(-1)![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!)
      : valoresDoCheck('core.meta', 'indicador');
    // T-0170: o banco aceita 'itens_por_pedido' antes do contrato; a parte do modulo-core acrescenta o valor a INDICADORES_META
    // (modules/core/contracts/sync.ts) e o banco-dados, a INDICADORES_META_BANCO. Só ESTE valor pode sobrar no banco.
    const SO_NO_BANCO_T0170 = 'itens_por_pedido';
    const contrato: string[] = [...INDICADORES_META];
    expect(checkMeta).toEqual(contrato.includes(SO_NO_BANCO_T0170) ? contrato : [...contrato, SO_NO_BANCO_T0170]);
    expect([...nuvemCore.INDICADORES_META_BANCO]).toEqual(contrato);
    expect(valoresDoCheck('vendedor.pedido', 'status')).toEqual([...ORDER_STATUSES]);
    expect([...(nuvemVendedor.pedido.status.enumValues ?? [])]).toEqual([...ORDER_STATUSES]);
  });

  it('rota_parada: usuario_id/data presos à rota (FK com on update cascade) e sequência única ADIÁVEL entre as vivas', () => {
    const rp = criadas.get('core.rota_parada')!;
    expect(rp).toMatch(/foreign key \(tenant_id, rota_id, usuario_id, data\)\s+references core\.rota \(tenant_id, id, usuario_id, data\) on update cascade/);
    expect(rp).toMatch(/exclude using btree \(tenant_id with =, rota_id with =, sequencia with =\)\s+where \(deleted_at is null\) deferrable initially deferred/);
  });

  it('pull por usuário: rota, rota_parada, visita, notificacao, meta com (tenant_id, usuario_id, updated_at, id); pedido por vendedor', () => {
    for (const t of ['rota', 'rota_parada', 'visita', 'notificacao', 'meta']) {
      expect(m6.up).toContain(`on core.${t} (tenant_id, usuario_id, updated_at, id);`);
    }
    expect(m7.up).toContain('create index pedido_vendedor_sync_ix on vendedor.pedido (tenant_id, vendedor_id, updated_at, id);');
    expect(m7.up).toContain('create index pedido_cliente_ix on vendedor.pedido (tenant_id, cliente_id, created_at desc);');
    expect(criadas.get('vendedor.pedido_item')).toContain('constraint pedido_item_sequencia_uk unique (tenant_id, pedido_id, sequencia)');
  });

  it('fronteira: vendedor.* sem FK para core.* (só plataforma.tenant e dentro do schema)', () => {
    expect(m7.up).not.toMatch(/references core\./);
    expect(m7.down).toContain('drop schema if exists vendedor cascade;');
  });

  it('RN-CORE-14: motivos de sistema e parâmetros do Core semeados em todo tenant (existentes e novos, gatilho)', () => {
    expect(m6.up).toContain("('cliente_fechado', 'loja_fechada',");
    expect(m6.up).toContain("('cliente_fechado', 'acesso_negado',");
    expect(m6.up).toContain("('checkin.raio_m',       '200'::jsonb)");
    expect(m6.up).toContain("('metas.base_apuracao',  '\"aprovado\"'::jsonb)");
    expect(m6.up).toContain('create trigger tenant_semear_core after insert on plataforma.tenant');
    expect(m6.up).toContain('select core.semear_padroes(t.id) from plataforma.tenant t;');
    // a semeadura não é SECURITY DEFINER (o macuxi_app não insere tenant; nada de função que ignore RLS)
    expect(m6.up.replace(/--.*$/gm, '')).not.toMatch(/security definer/i);
  });

  it('plataforma.arquivo (ADR 0010): índices por entidade e parcial dos aguardando; fora do sync', () => {
    expect(m5.up).toContain('create index arquivo_entidade_ix on plataforma.arquivo (tenant_id, entidade, entidade_id);');
    expect(m5.up).toContain("create index arquivo_aguardando_ix on plataforma.arquivo (tenant_id, situacao) where situacao = 'aguardando';");
    expect(TABELAS_FORA_DO_SYNC).toContain('plataforma.arquivo');
  });

  it('downs desfazem o que os ups criam', () => {
    expect(m5.down).toContain('drop table if exists plataforma.arquivo;');
    expect(m5.down).toContain('drop function if exists plataforma.uuid_de_chave(text);');
    for (const t of ['cliente_contato', 'cliente_financeiro', 'titulo', 'historico_compra', 'motivo', 'rota', 'rota_parada', 'visita', 'visita_etapa', 'notificacao', 'meta', 'indicador_diario']) {
      expect(m6.down).toContain(`drop table if exists core.${t};`);
    }
    for (const c of ['frequencia_semanas', 'dia_semana']) expect(m6.down).toContain(`alter table core.carteira drop column if exists ${c};`);
    for (const c of ['push_token', 'push_plataforma', 'push_atualizado_em']) expect(m6.down).toContain(`alter table core.dispositivo drop column if exists ${c};`);
    expect(m6.down).toContain('drop trigger if exists tenant_semear_core on plataforma.tenant;');
    // visita antes de rota_parada/motivo (FKs), parada antes de rota
    expect(m6.down.indexOf('drop table if exists core.visita;')).toBeLessThan(m6.down.indexOf('drop table if exists core.rota_parada;'));
    expect(m6.down.indexOf('drop table if exists core.rota_parada;')).toBeLessThan(m6.down.indexOf('drop table if exists core.rota;'));
  });
});

describe('T-0029: 0008 preço do Catálogo e 0009 pedido completo do Vendedor (estático, desenho T-0029 §10)', () => {
  const m8 = migracoes.find((x) => x.versao === '0008')!;
  const m9 = migracoes.find((x) => x.versao === '0009')!;
  const criadas = tabelasCriadas();
  const lista = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  /** Valores de `check (col in (...))` ou `check (col is null or col in (...))` no corpo da tabela. */
  const valoresDoCheck = (tabela: string, coluna: string): string[] => {
    const m = new RegExp(`check \\((?:${coluna} is null or )?${coluna} in \\(([^)]*)\\)\\)`).exec(criadas.get(tabela) ?? '');
    return m ? lista(m[1]!) : [];
  };

  it('listas fechadas = código do Vendedor: status (pedido e pedido_evento.de/para) x ORDER_STATUSES; níveis x NIVEIS_APROVACAO; motivos x MOTIVOS_APROVACAO', () => {
    expect(valoresDoCheck('vendedor.pedido', 'status')).toEqual([...ORDER_STATUSES]);
    expect(valoresDoCheck('vendedor.pedido_evento', 'de')).toEqual([...ORDER_STATUSES]);
    expect(valoresDoCheck('vendedor.pedido_evento', 'para')).toEqual([...ORDER_STATUSES]);
    expect(valoresDoCheck('vendedor.pedido', 'nivel_aprovacao')).toEqual([...NIVEIS_APROVACAO]);
    expect(valoresDoCheck('vendedor.pedido_evento', 'nivel')).toEqual([...NIVEIS_APROVACAO]);
    const motivos = /check \(motivos_aprovacao <@ array\[([^\]]*)\]::text\[\]\)/.exec(m9.up);
    expect(lista(motivos?.[1] ?? '')).toEqual([...MOTIVOS_APROVACAO]);
    // Drizzle com as mesmas listas
    expect([...(nuvemVendedor.pedido.nivel_aprovacao.enumValues ?? [])]).toEqual([...NIVEIS_APROVACAO]);
    expect([...(nuvemVendedor.pedidoEvento.para.enumValues ?? [])]).toEqual([...ORDER_STATUSES]);
    expect([...(nuvemVendedor.pedidoEvento.nivel.enumValues ?? [])]).toEqual([...NIVEIS_APROVACAO]);
    // o vocabulário dos eventos (STATUS_CONTRATO) não vai ao banco
    expect(m9.up).not.toMatch(/'em_aprovacao'|'aprovado'|'rejeitado'/);
  });

  it('RN-GES-08 e RN-VEN-10: pending_approval exige nível; rejected exige motivo com 3+ caracteres (dados antigos preenchidos antes)', () => {
    expect(m9.up).toContain("check (status <> 'pending_approval' or nivel_aprovacao is not null)");
    expect(m9.up).toContain("check (status <> 'rejected' or coalesce(char_length(btrim(motivo_rejeicao)), 0) >= 3)");
    expect(m9.up.indexOf("where status = 'pending_approval' and nivel_aprovacao is null")).toBeLessThan(m9.up.indexOf('add constraint pedido_pendente_com_nivel'));
    expect(m9.up.indexOf("where status = 'rejected'")).toBeLessThan(m9.up.indexOf('add constraint pedido_rejeitado_com_motivo'));
  });

  it('únicos parciais e índices das consultas (número, lista do BKO, condição padrão, tabela do cliente, preço vigente)', () => {
    for (const idx of [
      'create unique index pedido_numero_uk on vendedor.pedido (tenant_id, numero) where numero is not null;',
      'create index pedido_status_ix on vendedor.pedido (tenant_id, status, created_at desc);',
      'create index pedido_evento_pedido_ix on vendedor.pedido_evento (tenant_id, pedido_id, ocorrido_em);',
      'create unique index condicao_pagamento_codigo_uk on vendedor.condicao_pagamento (tenant_id, codigo) where deleted_at is null;',
      'create unique index condicao_pagamento_padrao_uk on vendedor.condicao_pagamento (tenant_id) where padrao and deleted_at is null;',
      'create unique index cliente_condicao_uk on vendedor.cliente_condicao (tenant_id, cliente_id, condicao_pagamento_id) where deleted_at is null;',
    ]) expect(m9.up).toContain(idx);
    for (const idx of [
      'create unique index tabela_preco_codigo_uk on catalogo.tabela_preco (tenant_id, codigo) where deleted_at is null;',
      'create unique index tabela_preco_item_vigencia_uk on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, vigencia_inicio) nulls not distinct where deleted_at is null;',
      'create unique index cliente_tabela_preco_cliente_uk on catalogo.cliente_tabela_preco (tenant_id, cliente_id) where deleted_at is null;',
    ]) expect(m8.up).toContain(idx);
    expect(criadas.get('catalogo.tabela_preco_item')).toContain('check (preco_cents > 0)');
    expect(criadas.get('catalogo.tabela_preco_item')).toContain('check (vigencia_inicio is null or vigencia_fim is null or vigencia_fim > vigencia_inicio)');
  });

  it('fronteira: catalogo e vendedor sem FK para outro schema; FKs compostas dentro do schema', () => {
    for (const m of [m8, m9]) expect(m.up.replace(/--.*$/gm, '')).not.toMatch(/references core\./);
    expect(m8.up.replace(/--.*$/gm, '')).not.toMatch(/references vendedor\./);
    expect(m9.up.replace(/--.*$/gm, '')).not.toMatch(/references catalogo\./);
    expect(criadas.get('catalogo.tabela_preco_item')).toContain('foreign key (tenant_id, tabela_preco_id) references catalogo.tabela_preco (tenant_id, id)');
    expect(criadas.get('catalogo.cliente_tabela_preco')).toContain('foreign key (tenant_id, tabela_preco_id) references catalogo.tabela_preco (tenant_id, id)');
    expect(criadas.get('vendedor.pedido_evento')).toContain('foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id)');
    expect(criadas.get('vendedor.cliente_condicao')).toContain('foreign key (tenant_id, condicao_pagamento_id) references vendedor.condicao_pagamento (tenant_id, id)');
    expect(m9.up).toContain('add constraint pedido_condicao_fk foreign key (tenant_id, condicao_pagamento_id) references vendedor.condicao_pagamento (tenant_id, id);');
  });

  it('número legível: contador por tenant (fora do sync), função invoker sem SECURITY DEFINER; histórico só leitura e inserção', () => {
    expect(TABELAS_FORA_DO_SYNC).toContain('vendedor.numeracao_pedido');
    expect(criadas.get('vendedor.numeracao_pedido')).toContain('constraint numeracao_pedido_tenant_uk unique (tenant_id)');
    expect(m9.up).toContain('create function vendedor.proximo_numero_pedido() returns text');
    expect(m9.up.replace(/--.*$/gm, '')).not.toMatch(/security definer/i);
    expect(m9.up).toContain('grant select, insert on vendedor.pedido_evento to macuxi_app;');
  });

  it('downs desfazem o que os ups criam', () => {
    expect(m8.down).toContain('drop schema if exists catalogo cascade;');
    for (const t of ['pedido_evento', 'numeracao_pedido', 'cliente_condicao', 'condicao_pagamento']) expect(m9.down).toContain(`drop table if exists vendedor.${t};`);
    expect(m9.down).toContain('drop function if exists vendedor.proximo_numero_pedido();');
    for (const [, tabela, coluna] of m9.up.matchAll(/^alter table (vendedor\.[a-z_]+) add column ([a-z_]+) /gm)) {
      expect(m9.down).toContain(`alter table ${tabela} drop column if exists ${coluna};`);
    }
    for (const [, nome] of m9.up.matchAll(/add constraint ([a-z_]+) /g)) expect(m9.down).toContain(`drop constraint if exists ${nome};`);
    for (const [, nome] of m9.up.matchAll(/^create (?:unique )?index ([a-z_]+) on vendedor\.pedido /gm)) expect(m9.down).toContain(`drop index if exists vendedor.${nome};`);
    // condicao_pagamento só depois de soltar a FK do pedido e a cliente_condicao
    expect(m9.down.indexOf('drop constraint if exists pedido_condicao_fk')).toBeLessThan(m9.down.indexOf('drop table if exists vendedor.condicao_pagamento;'));
    expect(m9.down.indexOf('drop table if exists vendedor.cliente_condicao;')).toBeLessThan(m9.down.indexOf('drop table if exists vendedor.condicao_pagamento;'));
  });
});

describe('T-0032: 0010 schema integracao e 0011 retenção da outbox (estático, desenho T-0032 §8)', () => {
  const m10 = migracoes.find((x) => x.versao === '0010')!;
  const m11 = migracoes.find((x) => x.versao === '0011')!;
  const criadas = tabelasCriadas();
  const sem = (sql: string) => sql.replace(/--.*$/gm, '');
  const lista = (trecho: string) => [...trecho.matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]!);
  /** Valores de `check (col in (...))` ou `check (col is null or col in (...))` no corpo da tabela. */
  const valoresDoCheck = (tabela: string, coluna: string): string[] => {
    const m = new RegExp(`check \\((?:${coluna} is null or )?${coluna} in \\(([^)]*)\\)\\)`).exec(criadas.get(tabela) ?? '');
    return m ? lista(m[1]!) : [];
  };
  /** Valores de `col <@ array[...]::text[]` no corpo da tabela. */
  const valoresDoArray = (tabela: string, coluna: string): string[] => {
    const m = new RegExp(`${coluna} <@ array\\[([^\\]]*)\\]::text\\[\\]`).exec(criadas.get(tabela) ?? '');
    return m ? lista(m[1]!) : [];
  };
  const CODIGOS_DESCARTE_BANCO = [...new Set<string>([...CODIGOS_ITEM_DESCARTADO, 'sequencia_repetida'])];

  it('todas as tabelas do schema integracao, fora do sync, com RLS forçado (o bloco S0-023 acima confere cada uma)', () => {
    expect([...criadas.keys()].filter((t) => t.startsWith('integracao.')).sort()).toEqual([...TABELAS_INTEGRACAO].sort());
    for (const t of TABELAS_INTEGRACAO) expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(t);
    expect(m10.up).toMatch(/^create schema integracao;$/m);
    expect(m10.down).toContain('drop schema if exists integracao cascade;');
  });

  it('listas fechadas = contratos da Integração (entidade, modo, status, códigos, tipos, estados)', () => {
    for (const t of ['sessao_carga', 'lote', 'registro_atual', 'pendencia_inativacao', 'inativacao_auditoria', 'cursor_entidade', 'reconciliacao']) {
      // corpo da 0010 = as 8 originais; a 0013 amplia os CHECKs (bloco 0013 abaixo confere ENTIDADES ⊆ ENTIDADES_BANCO)
      expect(valoresDoCheck(`integracao.${t}`, 'entidade'), t).toEqual([...nuvemIntegracao.ENTIDADES_ORIGINAIS]);
    }
    expect(valoresDoArray('integracao.conector', 'entidades')).toEqual([...nuvemIntegracao.ENTIDADES_ORIGINAIS]);
    expect(criadas.get('integracao.conector')).toContain(`default array[${nuvemIntegracao.ENTIDADES_ORIGINAIS.map((e) => `'${e}'`).join(', ')}]::text[]`);
    expect(valoresDoCheck('integracao.conector', 'tipo')).toEqual([...TIPOS_CONECTOR]);
    expect(valoresDoCheck('integracao.lote', 'modo')).toEqual([...ModoCarga.options]);
    expect(valoresDoCheck('integracao.lote', 'status')).toEqual([...ESTADOS_LOTE]);
    expect(valoresDoCheck('integracao.lote_linha_erro', 'codigo')).toEqual([...CODIGOS_ERRO_LINHA]);
    expect(valoresDoCheck('integracao.pendencia_inativacao', 'estado')).toEqual([...ESTADOS_PENDENCIA_INATIVACAO]);
    expect(valoresDoCheck('integracao.pendencia_inativacao', 'decidida_por_perfil')).toEqual(['admin', 'analista']);
    // corpo da 0010 = os 3 originais; a 0054 recria o CHECK com 'canal' (= TIPOS_MAPEAMENTO; mapeamento-canal.test.ts)
    expect(valoresDoCheck('integracao.mapeamento', 'tipo')).toEqual(['condicao_pagamento', 'deposito', 'status']);
    const m54 = migracoes.find((x) => x.versao === '0054')!;
    const tipos54 = /add constraint mapeamento_tipo_valido\s+check \(tipo in \(([^)]*)\)\)/.exec(m54.up)?.[1] ?? '';
    expect([...tipos54.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...TIPOS_MAPEAMENTO]);
    expect(valoresDoCheck('integracao.pedido_fila_erp', 'estado')).toEqual([...ESTADOS_PEDIDO_ERP]);
    expect(valoresDoCheck('integracao.pedido_fila_erp', 'retencao_codigo')).toEqual([...nuvemIntegracao.RETENCOES_PEDIDO_ERP]);
    expect(valoresDoCheck('integracao.pedido_retorno', 'status')).toEqual([...StatusRetornoErp.options]);
    expect(valoresDoCheck('integracao.pedido_retorno_erro', 'status')).toEqual([...StatusRetornoErp.options]);
    // P-4 + decisão do gerente: o contrato + 'sequencia_repetida' (vale antes e depois de o contrato ganhar o código)
    expect(valoresDoCheck('integracao.pedido_retorno_erro', 'codigo')).toEqual(CODIGOS_DESCARTE_BANCO);
    expect(valoresDoArray('integracao.pedido_retorno_erro', 'codigos')).toEqual(CODIGOS_DESCARTE_BANCO);
    expect([...nuvemIntegracao.CODIGOS_ITEM_DESCARTADO_BANCO]).toEqual(CODIGOS_DESCARTE_BANCO);
    // Drizzle com as mesmas listas
    expect([...(nuvemIntegracao.lote.status.enumValues ?? [])]).toEqual([...ESTADOS_LOTE]);
    expect([...(nuvemIntegracao.lote.entidade.enumValues ?? [])]).toEqual([...ENTIDADES]);
    expect([...(nuvemIntegracao.pedidoRetornoErro.codigo.enumValues ?? [])]).toEqual(CODIGOS_DESCARTE_BANCO);
    expect([...(nuvemIntegracao.pedidoFilaErp.estado.enumValues ?? [])]).toEqual([...ESTADOS_PEDIDO_ERP]);
  });

  it('external_id do ERP até 200 caracteres onde há limite (T-0027)', () => {
    expect(criadas.get('integracao.registro_atual')).toContain('check (char_length(external_id) between 1 and 200)');
    expect(criadas.get('integracao.sessao_carga_recebido')).toContain('check (char_length(external_id) between 1 and 200)');
    expect(criadas.get('integracao.lote_linha_erro')).toContain('check (external_id is null or char_length(external_id) between 1 and 200)');
    expect(criadas.get('integracao.cursor_entidade')).toContain('check (cursor_external_id is null or char_length(cursor_external_id) between 1 and 200)');
    expect(criadas.get('integracao.pedido_retorno_erro')).toContain('check (char_length(produto_external_id) between 1 and 200)');
    expect(criadas.get('integracao.cursor_entidade')).toContain('cursor_external_id  text collate "C"');
  });

  it('unicidades e índices das consultas (idempotência, P-7, chave, fila, pendência, espelho)', () => {
    for (const trecho of [
      'create unique index conector_recebe_pedidos_uk on integracao.conector (tenant_id) where recebe_pedidos and ativo and deleted_at is null;',
      'create unique index conector_identificador_uk on integracao.conector (tenant_id, identificador) where deleted_at is null;',
      'create unique index credencial_hash_uk on integracao.credencial (hash_chave);',
      'create unique index credencial_papel_uk on integracao.credencial (tenant_id, conector_id, papel) where revogada_em is null and deleted_at is null;',
      "create unique index lote_processando_uk on integracao.lote (tenant_id, conector_id, entidade) where status = 'processando';",
      "create index lote_fila_ix on integracao.lote (tenant_id, status, recebido_em) where status in ('recebido', 'processando');",
      'create unique index registro_atual_chave_uk on integracao.registro_atual (tenant_id, entidade, external_id) include (hash, alterado_em);',
      'create index registro_atual_ativos_ix on integracao.registro_atual (tenant_id, entidade, conector_id, visto_em) include (valor_controle) where ativo and deleted_at is null;',
      "create unique index pendencia_inativacao_aguardando_uk on integracao.pendencia_inativacao (tenant_id, conector_id, entidade) where estado = 'aguardando';",
      'create index inativacao_auditoria_decidida_ix on integracao.inativacao_auditoria (tenant_id, decidida_em desc);',
      'create index inativacao_auditoria_pendencia_ix on integracao.inativacao_auditoria (tenant_id, pendencia_id);',
      "create index pedido_fila_erp_poll_ix on integracao.pedido_fila_erp (tenant_id, aprovado_em) where estado = 'pendente' and retencao_codigo is null and deleted_at is null;",
      'create unique index pedido_retorno_uk on integracao.pedido_retorno (tenant_id, pedido_uuid, status, nota_numero, nota_serie) nulls not distinct;',
      'create index pedido_retorno_erro_criado_ix on integracao.pedido_retorno_erro (tenant_id, created_at desc);',
      'create index pedido_retorno_erro_pedido_ix on integracao.pedido_retorno_erro (tenant_id, pedido_uuid);',
      "create unique index mapeamento_codigo_macuxi_uk on integracao.mapeamento (tenant_id, tipo, codigo_macuxi) where tipo = 'condicao_pagamento' and ativo and deleted_at is null;",
    ]) expect(m10.up).toContain(trecho);
    expect(criadas.get('integracao.lote')).toContain('constraint lote_idempotencia_uk unique (tenant_id, conector_id, chave_idempotencia)');
    expect(criadas.get('integracao.sessao_carga_recebido')).toContain('constraint sessao_carga_recebido_uk unique (tenant_id, sessao_id, external_id)');
    expect(criadas.get('integracao.pedido_fila_erp')).toContain('constraint pedido_fila_erp_pedido_uk unique (tenant_id, pedido_uuid)');
  });

  it('auditoria da inativação append-only (só select e insert, sem gatilho de updated_at); pedido_retorno só insert', () => {
    expect(m10.up).toContain('grant select, insert on integracao.inativacao_auditoria to macuxi_app;');
    expect(m10.up).not.toMatch(/create trigger inativacao_auditoria_updated_at/);
    expect(m10.up).toContain('grant select, insert on integracao.pedido_retorno to macuxi_app;');
    expect(criadas.get('integracao.inativacao_auditoria')).toContain("check (acao = 'confirmar' or inativadas is null)");
    expect(criadas.get('integracao.pendencia_inativacao')).toContain('check (char_length(motivo_decisao) <= 300)');
  });

  it('fronteira: nenhuma FK para schema de módulo; FKs compostas dentro do schema', () => {
    expect(sem(m10.up)).not.toMatch(/references (core|vendedor|catalogo|promotor|gestor|pesquisa|treinamento)\./);
    for (const t of TABELAS_INTEGRACAO) {
      for (const [, ref] of (criadas.get(t) ?? '').matchAll(/references ([a-z_]+\.[a-z_]+) \(/g)) {
        expect(['plataforma.tenant', ...TABELAS_INTEGRACAO], `${t} -> ${ref}`).toContain(ref);
      }
    }
    expect(criadas.get('integracao.inativacao_auditoria')).toContain('foreign key (tenant_id, pendencia_id) references integracao.pendencia_inativacao (tenant_id, id)');
    expect(criadas.get('integracao.pedido_retorno_erro')).toContain('foreign key (tenant_id, pedido_retorno_id) references integracao.pedido_retorno (tenant_id, id)');
  });

  it('funções SECURITY DEFINER com search_path fixo; autenticar_chave só ao app, expurgos só ao worker', () => {
    expect(m10.up).toMatch(/create function integracao\.autenticar_chave\(p_hash text\)[\s\S]*?language sql stable security definer\s+set search_path = pg_catalog, integracao/);
    expect(m10.up).toContain('revoke all on function integracao.autenticar_chave(text) from public;');
    expect(m10.up).toContain('grant execute on function integracao.autenticar_chave(text) to macuxi_app;');
    // devolve entidades e recebe_pedidos do Conector e nunca o hash
    const corpo = /create function integracao\.autenticar_chave[\s\S]*?\$\$;/.exec(m10.up)![0];
    expect(corpo).toContain('recebe_pedidos boolean, entidades text[]');
    const select = corpo.split('$$')[1]!;
    expect(select.slice(0, select.indexOf('from integracao.credencial'))).not.toContain('hash_chave');
    expect(select).toContain('where k.hash_chave = p_hash');
    expect(m10.up).toMatch(/create function integracao\.expurgar_retencao[\s\S]*?security definer\s+set search_path = pg_catalog, integracao/);
    expect(m10.up).toContain('revoke all on function integracao.expurgar_retencao(timestamptz, integer) from public;');
    expect(m11.up).toMatch(/create function plataforma\.expurgar_outbox[\s\S]*?security definer\s+set search_path = pg_catalog, plataforma/);
    expect(m11.up).toContain('revoke all on function plataforma.expurgar_outbox(timestamptz, integer) from public;');
  });

  it('0011: índice dos publicados, comentário de legado e down que desfaz tudo', () => {
    expect(m11.up).toContain('create index evento_publicado_ix on plataforma.evento (tenant_id, publicado_em) where publicado_em is not null;');
    expect(m11.up).toContain("comment on column plataforma.tenant_modulo.parametros is 'LEGADO");
    for (const trecho of [
      'comment on column plataforma.tenant_modulo.parametros is null;',
      'drop function if exists plataforma.expurgar_outbox(timestamptz, integer);',
      'drop index if exists plataforma.evento_publicado_ix;',
    ]) expect(m11.down).toContain(trecho);
  });

  it('0012 (T-0042): pg_temp por último no search_path das 4 funções SECURITY DEFINER; down volta ao anterior', () => {
    const m12 = migracoes.find((x) => x.versao === '0012')!;
    const funcoes: Array<[string, string]> = [
      ['plataforma.tenant_por_codigo(text)', 'plataforma'],
      ['integracao.autenticar_chave(text)', 'integracao'],
      ['integracao.expurgar_retencao(timestamptz, integer)', 'integracao'],
      ['plataforma.expurgar_outbox(timestamptz, integer)', 'plataforma'],
    ];
    for (const [f, schema] of funcoes) {
      expect(m12.up).toContain(`alter function ${f} set search_path = pg_catalog, ${schema}, pg_temp;`);
      expect(m12.down).toContain(`alter function ${f} set search_path = pg_catalog, ${schema};`);
    }
    // toda função SECURITY DEFINER criada até a 0012 está na lista; as criadas depois nascem com pg_temp por último no create
    const definersAte = (ate: string) =>
      migracoes.filter((m) => m.versao <= ate).flatMap((m) => [...m.up.matchAll(/create function ([a-z_]+\.[a-z_]+)\([^)]*\)[^;]*?security definer/g)].map((x) => x[1]));
    expect(definersAte('0012').sort()).toEqual(funcoes.map(([f]) => f.slice(0, f.indexOf('('))).sort());
    const depois = migracoes.filter((m) => m.versao > '0012');
    const novas = depois.flatMap((m) => [...m.up.matchAll(/create function ([a-z_]+\.[a-z_]+)\([^)]*\)[^;]*?security definer\s+set search_path = ([^\n]+)/g)]);
    // 0024 (T-0078): só agregados da outbox; 0027 (T-0039, ADR 0022): só ids dos tenants ativos, ao worker
    // 0035 (T-0087, ADR 0029): as 20 funções do super-admin (super-admin.test.ts confere grant e search_path no banco)
    // 0039 (T-0093, ADR 0031): as sa_* novas com create function (as reescritas usam create or replace; a sa_sessao_valida
    // volta a ser criada porque mudou o retorno); portal-email-senha.test.ts confere todas, inclusive as or replace
    const nome = (f: string) => f.slice(0, f.indexOf('('));
    const reescritas039 = ['plataforma.sa_revogar', 'plataforma.sa_auditar', 'plataforma.sa_listar_tenants', 'plataforma.sa_tenant_ativo', 'plataforma.sa_provisionar_tenant'];
    // 0040 (T-0094, ADR 0032): as 4 sa_* do login do portal recriadas (drop + create) com a versão da conta (senha-email-saida.test.ts)
    const recriadas040 = ['plataforma.sa_contas_para_login', 'plataforma.sa_abrir_sessao_portal', 'plataforma.sa_escolher_empresa', 'plataforma.sa_sessao_valida'];
    // 0042 (T-0094, padrão de fábrica da T-0111): as 2 sa_* do super-admin para o admin do cliente (portal-redefinir-senha.test.ts)
    // 0047 (resto do D-MP2): a sa_admins_da_empresa recriada (drop + create, o retorno ganha entra_no_portal; portal-admin-multiperfil.test.ts)
    // 0052 (T-0122 N5): tenant_por_codigo recriada (drop + create, o retorno fica só id e status; tenant-por-codigo-minimo.test.ts)
    // 0058 (T-0158, ADR 0043): as 2 sa_* do diagnóstico (portal) e o expurgo de 90 dias (worker) (diagnostico.test.ts)
    // 0069 (ADR 0049): a função de gatilho do promotor, conferida no COMMIT do portal (cargo-hierarquia.db.test.ts)
    // 0070 (ADR 0047): a sa_* que grava a assinatura da empresa (plano-assinatura.db.test.ts); a 0071 reescreve a
    // sa_listar_tenants com create or replace
    // 0072 (ADR 0052): as 8 sa_* das ações da empresa e as 11 do worker (empresa-acoes.db.test.ts)
    // 0073 (rodapé legal): a leitura pública (app) e as 2 sa_* dos dados legais (portal) (dados-legais.db.test.ts)
    // 0077 (T-0176): a função de gatilho da filial de cadastro, pelo mesmo motivo (usuario-filial.db.test.ts)
    // 0077 (RN-CORE-39 no portal): a sa_sessao_valida recriada (drop + create, o retorno ganha sem_filial; usuario-filial.db.test.ts)
    // 0079 (T-0174, ADR 0058): as 3 funções do laço de trabalhos, só ao worker (foto-lote.db.test.ts)
    // 0080 (T-0175, RN-CORE-59): a função dos gatilhos do Código FDV, que grava o contador (usuario-codigo-fdv.db.test.ts)
    expect(novas.map((x) => x[1]).sort()).toEqual(
      ['plataforma.resumo_outbox', 'plataforma.tenants_ativos', ...FUNCOES_SA_0035.map(nome), ...FUNCOES_SA.map(nome).filter((f) => !reescritas039.includes(f)), ...recriadas040, ...FUNCOES_SA_0042.map(nome), 'plataforma.sa_admins_da_empresa', 'plataforma.tenant_por_codigo', ...FUNCOES_SA_0058.map(nome), 'plataforma.expurgar_diagnosticos', 'core.promotor_conferir', ...FUNCOES_SA_0070.map(nome), ...FUNCOES_SA_0072.map(nome), ...FUNCOES_WORKER_0072.map(nome), nome(DADOS_LEGAIS_PUBLICOS), ...FUNCOES_SA_0073.map(nome), 'core.filial_cadastro_conferir', 'plataforma.sa_sessao_valida', 'plataforma.trabalho_reservar', 'plataforma.trabalho_devolver', 'plataforma.trabalho_renovar', 'core.usuario_codigo_fdv'].sort(),
    );
    for (const x of novas) expect(x[2], `${x[1]}: pg_temp por último`).toMatch(/, pg_temp$/);
    expect(depois.flatMap((m) => [...m.up.matchAll(/create function ([a-z_]+\.[a-z_]+)\([^)]*\)[^;]*?security definer/g)]).length).toBe(novas.length);
  });

  it('fixture: chave do Conector como HMAC-SHA256(pepper da fixture, chave), sem a chave em claro no banco', () => {
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    for (const X of [DOIS_TENANTS.A, DOIS_TENANTS.B]) {
      const k = d['integracao.credencial'].find((l) => l.tenant_id === X.tenantId)!;
      expect(k.hash_chave).toBe(crypto.createHmac('sha256', PEPPER_HUB_FIXTURE).update(X.integracao.chave.chave).digest('hex'));
      expect(JSON.stringify(d['integracao.credencial'])).not.toContain(X.integracao.chave.chave);
      expect(X.integracao.chave.chave).toMatch(/^mxk_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe('0013 catálogo (cota, conteúdo, busca), vendedor (orçamento, frete, faturamento) e core (cadastro mínimo) — estático', () => {
  const m13 = migracoes.find((x) => x.versao === '0013')!;
  const criadas = tabelasCriadas();
  const semComentarios = m13.up.replace(/--.*$/gm, '');

  it('RN-CAT-03: cota por (tenant, usuário, dia) com incremento atômico e condicional, função do invocador e fora do sync', () => {
    expect(criadas.get('catalogo.uso_ia')).toContain('constraint uso_ia_dia_uk unique (tenant_id, usuario_id, dia)');
    // hora-fixa-ok: texto da assinatura da função na migração (não é SQL executado nem comparado ao relógio)
    expect(m13.up).toContain('create function catalogo.debitar_cota_ia(p_usuario_id uuid, p_limite integer, p_agora timestamptz default now())');
    expect(m13.up).toMatch(/on conflict on constraint uso_ia_dia_uk do update\s+set consultas = u\.consultas \+ 1\s+where u\.consultas < p_limite/);
    expect(m13.up).toContain('(p_agora at time zone t.fuso)::date');
    expect(semComentarios).not.toMatch(/security definer/i);
    expect(m13.up).toContain('revoke all on function catalogo.debitar_cota_ia(uuid, integer, timestamptz) from public;');
    expect(TABELAS_FORA_DO_SYNC).toEqual(expect.arrayContaining(['catalogo.uso_ia', 'catalogo.busca_log']));
  });

  it('fronteira: nenhuma FK para outro schema de módulo; FKs compostas dentro do schema', () => {
    for (const comando of semComentarios.split(';')) {
      const alvo = /(?:create table|alter table) ([a-z_]+)\.([a-z_]+)/.exec(comando);
      if (!alvo) continue;
      for (const [, destino] of comando.matchAll(/references ([a-z_]+)\./g)) {
        if (destino !== 'plataforma') expect(destino, `FK de ${alvo[1]}.${alvo[2]} para ${destino}`).toBe(alvo[1]);
      }
    }
    expect(criadas.get('catalogo.estoque_saldo')).toContain('foreign key (tenant_id, deposito_id) references catalogo.deposito (tenant_id, id)');
    expect(criadas.get('catalogo.produto_no')).toContain('foreign key (tenant_id, no_id) references catalogo.catalogo_no (tenant_id, id)');
    expect(criadas.get('core.cliente_endereco')).toContain('foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id)');
    expect(m13.up).toContain('add constraint pedido_orcamento_fk foreign key (tenant_id, orcamento_id) references vendedor.pedido (tenant_id, id);');
  });

  it('RN-VEN-13/32: orçamento nunca vai a aprovação nem ao ERP; acréscimo e desconto excludentes; total sem frete', () => {
    expect(m13.up).toContain("check (tipo = 'pedido' or status in ('draft', 'queued', 'received', 'cancelled'))");
    expect(m13.up).toContain('check (desconto_pct = 0 or acrescimo_pct = 0)');
    expect(m13.up).toContain("check (frete_modalidade is distinct from 'CIF' or (transportadora_id is null and not transportadora_digitada))");
    expect(m13.up).toContain("check (frete_modalidade is distinct from 'FOB' or transportadora_id is not null or transportadora_digitada)");
    expect(m13.up).not.toMatch(/frete_cents|frete_pct|frete_tipo|cliente_frete/); // R-20261102-105040: o pedido não tem valor de frete
    expect(m13.up).toContain('create unique index pedido_orcamento_uk on vendedor.pedido (tenant_id, orcamento_id) where orcamento_id is not null and deleted_at is null;');
    expect(m13.up).toContain('check (quantidade_base = quantidade * fator)');
    expect(m13.up).toContain('grant select, insert on vendedor.pedido_faturamento to macuxi_app;');
    expect(criadas.get('vendedor.pedido_faturamento')).toContain('constraint pedido_faturamento_evento_uk unique (tenant_id, evento_id)');
  });

  it('integração (T-0061 §6, ADR 0016): CHECKs de entidade com as 12 da 0013 (a 0037 amplia para as 15), contrato contido no banco; exige_conector semver', () => {
    for (const e of ENTIDADES) expect([...nuvemIntegracao.ENTIDADES_BANCO]).toContain(e);
    const banco = [...nuvemIntegracao.ENTIDADES_0013]; // a 0037 confere as 15 em forma-prazo-escalonada.test.ts
    const lista = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    for (const t of ['sessao_carga', 'lote', 'registro_atual', 'pendencia_inativacao', 'inativacao_auditoria', 'cursor_entidade', 'reconciliacao']) {
      const m = new RegExp(`alter table integracao\\.${t} add constraint ${t}_entidade_valida check \\(entidade in \\(([^)]*)\\)\\);`).exec(m13.up);
      expect(lista(m?.[1] ?? ''), t).toEqual(banco);
    }
    const c = /add constraint conector_entidades_validas check \(cardinality\(entidades\) >= 1 and entidades <@ array\[([^\]]*)\]/.exec(m13.up);
    expect(lista(c?.[1] ?? '')).toEqual(banco);
    expect(m13.up).toContain(String.raw`check (exige_conector is null or exige_conector ~ '^[0-9]+\.[0-9]+\.[0-9]+$')`);
    expect(m13.up).toContain('check (quantidade_faturada between 0 and quantidade_base)');
  });

  it('RN-CORE-16/17: cadastro incompleto coerente com a lista de campos faltantes', () => {
    expect(m13.up).toContain('check (cadastro_incompleto = (cardinality(cadastro_campos_faltantes) > 0))');
  });

  it('down desfaz o que o up cria (tabelas, funções, colunas, constraints e índices) e devolve o único da 0008', () => {
    for (const t of TABELAS_0013) expect(m13.down).toContain(`drop table if exists ${t};`);
    for (const [, f] of m13.up.matchAll(/^create function ([a-z_]+\.[a-z_]+)\(/gm)) expect(m13.down).toContain(`drop function if exists ${f}(`);
    for (const [, tabela, coluna] of m13.up.matchAll(/^alter table ([a-z_]+\.[a-z_]+) add column ([a-z_]+) /gm)) {
      expect(m13.down).toContain(`alter table ${tabela} drop column if exists ${coluna};`);
    }
    for (const [, nome] of m13.up.matchAll(/add constraint ([a-z_]+) /g)) expect(m13.down).toContain(`drop constraint if exists ${nome};`);
    // índices novos em tabelas que já existiam antes da 0013 (as tabelas novas levam os seus no drop table)
    for (const [, nome, schema] of m13.up.matchAll(/^create (?:unique )?index ([a-z_]+) on ([a-z_]+)\.(?:pedido|cliente|tabela_preco_item) /gm)) {
      expect(m13.down).toContain(`drop index if exists ${schema}.${nome};`);
    }
    expect(m13.down).toContain('create unique index tabela_preco_item_vigencia_uk on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, vigencia_inicio) nulls not distinct where deleted_at is null;');
    expect(m13.down.indexOf("delete from vendedor.pedido where tipo = 'orcamento';")).toBeLessThan(m13.down.indexOf('drop column if exists tipo;'));
  });
});

describe('base de demo x T-0029 (estático)', () => {
  const d = dadosDemo('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { hoje: '2026-11-04' });

  it('alçadas do Vendedor nos parâmetros do tenant (5/10/15, acima do gerente = analista) (frete e desconto máximo sem linha = padrão)', () => {
    const p = Object.fromEntries(d['plataforma.parametro'].filter((x) => x.modulo === 'vendedor').map((x) => [x.chave, JSON.parse(String(x.valor))]));
    expect(p).toEqual({ ...ALCADAS_DEMO });
  });

  it('pedidos com status, nível e motivos dentro das listas do contrato', () => {
    for (const p of d['vendedor.pedido']) {
      expect(ORDER_STATUSES as readonly string[]).toContain(p.status);
      if (p.nivel_aprovacao !== null) expect(NIVEIS_APROVACAO as readonly string[]).toContain(p.nivel_aprovacao);
      for (const m of String(p.motivos_aprovacao).replace(/[{}]/g, '').split(',').filter(Boolean)) expect(MOTIVOS_APROVACAO as readonly string[]).toContain(m);
    }
    for (const e of d['vendedor.pedido_evento']) {
      expect(ORDER_STATUSES as readonly string[]).toContain(e.para);
      if (e.de !== null) expect(ORDER_STATUSES as readonly string[]).toContain(e.de);
    }
  });
});

describe('Drizzle x migrações (estático)', () => {
  const drizzle = tabelasDrizzle();
  // schemas de SEM_ESPELHO_DRIZZLE (hoje nenhum) ficam fora da comparação até ganharem espelho
  const criadas = new Map([...tabelasCriadas()].filter(([t]) => !SEM_ESPELHO_DRIZZLE.includes(t.split('.')[0]!)));

  it('toda tabela da migração tem espelho em Drizzle e vice-versa (menos os schemas de SEM_ESPELHO_DRIZZLE)', () => {
    expect([...drizzle.keys()].sort()).toEqual([...criadas.keys()].sort());
    expect([...drizzle.keys()].filter((t) => SEM_ESPELHO_DRIZZLE.includes(t.split('.')[0]!))).toEqual([]);
  });

  for (const [tabela, cfg] of drizzle) {
    it(`${tabela}: mesmas colunas do SQL`, () => {
      const corpo = criadas.get(tabela) ?? '';
      // colunas pendentes de espelho (src/excecoes.ts): aceitas com ou sem espelho
      const pendentes = (COLUNAS_SEM_ESPELHO_DRIZZLE[tabela] ?? []).filter((c) => !cfg.columns.some((col) => col.name === c));
      const doSql = [...corpo.matchAll(/^ {2}([a-z_][a-z0-9_]*) +[a-z]/gm)].map((m) => m[1]!).filter((c) => c !== 'constraint' && !pendentes.includes(c)).sort();
      expect(cfg.columns.map((c) => c.name).sort()).toEqual(doSql);
    });
  }
});

describe('perfis: SQL e Drizzle x @macuxi/platform-sdk (fonte única)', () => {
  const doSdk = [...PERFIS].sort();

  it('todo CHECK de perfil das migrações tem exatamente os PERFIS do platform-sdk (decisão de inativação: subconjunto)', () => {
    const criadas = tabelasCriadas();
    const checksDe = (corpo: string) => [...corpo.matchAll(/check \(perfil in \(([^)]*)\)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort());
    // 0058 (T-0158): plataforma.diagnostico.perfil (o perfil base de quem enviou) também tem os PERFIS inteiros
    const completos = [...checksDe(criadas.get('plataforma.perfil_modulo') ?? ''), ...checksDe(criadas.get('core.usuario') ?? ''), ...checksDe(criadas.get('plataforma.diagnostico') ?? '')];
    expect(completos.length, 'CHECKs de perfil (plataforma.perfil_modulo, core.usuario e plataforma.diagnostico)').toBe(3);
    for (const lista of completos) expect(lista).toEqual(doSdk);
    // 0041 (ADR 0033): o CHECK de perfil_modulo sai (o perfil vira o código do perfil do tenant, com FK) e entra a base do perfil
    expect(sqlUp).toContain('alter table plataforma.perfil_modulo drop constraint perfil_modulo_perfil_valido;');
    const base = /perfil_base_valida\s+check \(base in \(([^)]*)\)\)/.exec(criadas.get('plataforma.perfil') ?? '');
    expect([...(base?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort()).toEqual(doSdk);
    // integracao.inativacao_auditoria.perfil (P-3): só quem decide a inativação, e dentro dos PERFIS
    const auditoria = checksDe(criadas.get('integracao.inativacao_auditoria') ?? '');
    expect(auditoria).toEqual([['admin', 'analista']]);
    expect(checksDe(sqlUp).length).toBe(4);
    for (const p of auditoria[0]!) expect(doSdk).toContain(p);
  });

  it('colunas perfil do Drizzle usam os PERFIS do platform-sdk', () => {
    // 0041: perfil_modulo.perfil é o código do perfil do tenant (texto livre); a base fica em plataforma.perfil
    expect([...(esquemaPlataforma.perfil.base.enumValues ?? [])].sort()).toEqual(doSdk);
    expect([...(nuvemCore.usuario.perfil.enumValues ?? [])].sort()).toEqual(doSdk);
    expect([...(esquemaPlataforma.diagnostico.perfil.enumValues ?? [])].sort()).toEqual(doSdk);
  });
});

describe('fixture dois-tenants (estático)', () => {
  const dados = { ...dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA'), ...dadosTreinamento(new Date(0)) }; // hora-fixa-ok: só conta linhas por tenant
  const A = DOIS_TENANTS.A.tenantId;
  const B = DOIS_TENANTS.B.tenantId;
  const comTenant = [...tabelasCriadas().keys()].filter((t) => !(t in TABELAS_SEM_TENANT_ID));

  it('cobre toda tabela com tenant_id, com pelo menos 1 linha em CADA tenant', () => {
    // pesquisa.resposta_item e pesquisa.resposta_foto: o gatilho da resposta as preenche (fora de ORDEM_TABELAS e de dados)
    // treinamento (0017): fixture própria, carregada logo depois da dois-tenants (testes/fixture-treinamento.ts)
    // super-admin (0035, ADR 0029): fora dos tenants e só por função; não é dado de tenant (super-admin.test.ts cria as linhas)
    const deTenant = [...tabelasCriadas().keys()].filter((t) => !(TABELAS_SO_POR_FUNCAO as readonly string[]).includes(t));
    expect([...ORDEM_TABELAS, ...TABELAS_PESQUISA_DO_GATILHO, ...ORDEM_TREINAMENTO].sort()).toEqual(deTenant.sort());
    for (const t of comTenant.filter((x) => !(TABELAS_PESQUISA_DO_GATILHO as readonly string[]).includes(x))) {
      const linhas = dados[t as keyof typeof dados];
      expect(linhas.filter((l) => l.tenant_id === A).length, `${t} em A`).toBeGreaterThan(0);
      expect(linhas.filter((l) => l.tenant_id === B).length, `${t} em B`).toBeGreaterThan(0);
    }
  });

  it('T-0033: carregarFixtureDosTestes (a de @macuxi/db/teste e do globalSetup) grava dois-tenants E Treinamento numa carga só', async () => {
    // banco-modelo-t0033 (tests/) criava o próprio banco só com carregarDoisTenants: o schema treinamento ficava vazio (retrato 2)
    const sqls: string[] = [];
    const falso = { query: async (sql: string, params?: unknown[]) => (sqls.push(sql), { rows: [], rowCount: Array.isArray(params) ? params.length : 0 }) };
    await carregarFixtureDosTestes(falso as unknown as Parameters<typeof carregarFixtureDosTestes>[0], { agora: new Date(0), senha: 'x' }); // hora-fixa-ok: só conta tabelas
    const gravadas = new Set(sqls.map((q) => /^insert into (\S+) /.exec(q)?.[1]).filter(Boolean));
    for (const t of [...ORDEM_TABELAS, ...ORDEM_TREINAMENTO]) expect(gravadas.has(t), t).toBe(true);
    const teste = readFileSync(join(PASTA_DB, 'src', 'teste', 'index.ts'), 'utf8');
    expect(teste).toMatch(/export \{ carregarFixtureDosTestes[^}]*\} from '\.\.\/\.\.\/testes\/fixture-treinamento'/);
    expect(readFileSync(join(PASTA_DB, 'testes', 'global-setup.ts'), 'utf8')).toContain('preparar: (c) => carregarFixtureDosTestes(c, { agora })');
  });

  it('retrato do cliente do pedido (cliente_resumo) no formato do contrato ClienteDoPedido: nulo ou tudo texto (R-20261108-130439-testes)', () => {
    const comRetrato = dados['vendedor.pedido'].filter((p) => p.cliente_resumo != null);
    expect(comRetrato.length).toBeGreaterThan(0);
    for (const p of comRetrato) expect(ClienteDoPedido.safeParse(p.cliente_resumo).success, String(p.id)).toBe(true);
  });

  it('UUIDs fixos com prefixo do tenant e sem repetição', () => {
    // 0045 (T-0113, ADR 0034): a marca ativa do Catálogo É o concorrente do Promotor copiado (mesmo id, de propósito)
    const doPromotor = new Set(dados['promotor.concorrente'].map((l) => String(l.id)));
    const copias = dados['catalogo.marca_concorrente'].filter((l) => doPromotor.has(String(l.id)));
    expect(copias.map((l) => l.id).sort()).toEqual([...doPromotor].sort());
    const ids = Object.entries(dados)
      .flatMap(([t, linhas]) => (t === 'catalogo.marca_concorrente' ? linhas.filter((l) => !doPromotor.has(String(l.id))) : linhas))
      .map((l) => String(l.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of Object.keys(dados)) {
      for (const l of dados[t as keyof typeof dados]) {
        const dono = t === 'plataforma.tenant' ? l.id : l.tenant_id;
        // core.medida (0018): id determinístico do banco (a semeadura e a fixture gravam a MESMA linha)
        if (t === 'core.medida') {
          expect(l.id).toBe(idMedida(String(l.tenant_id), String(l.sigla)));
          continue;
        }
        // plataforma.usuario_perfil (0069): o vínculo principal com o id do gatilho usuario_perfil_principal (a carga e o gatilho gravam a MESMA linha)
        if (t === 'plataforma.usuario_perfil') {
          expect(l.id).toBe(idUsuarioPerfil(String(l.tenant_id), String(l.usuario_id), String(l.perfil_id)));
          continue;
        }
        // core.usuario_codigo_fdv_contador (0080): id determinístico do gatilho usuario_codigo_fdv_emitir (a carga e o gatilho gravam a MESMA linha)
        if (t === 'core.usuario_codigo_fdv_contador') {
          expect(l.id).toBe(idDeChave(`${String(l.tenant_id)}:core.usuario_codigo_fdv_contador`));
          continue;
        }
        expect(String(l.id).slice(0, 8)).toBe(dono === A ? 'aaaaaaaa' : 'bbbbbbbb');
      }
    }
  });

  it('usuários e módulos conforme tests/plano/sprint-0.md §3', () => {
    const us = dados['core.usuario'];
    expect(us.filter((u) => u.tenant_id === A).map((u) => u.perfil).sort()).toEqual(
      ['admin', 'analista', 'assistente', 'gerente', 'supervisor', 'vendedor', 'vendedor', 'promotor'].sort(),
    );
    expect(us.filter((u) => u.tenant_id === B).map((u) => u.perfil).sort()).toEqual(['admin', 'vendedor']);
    expect(us.every((u) => String(u.email).endsWith('@exemplo.com.br'))).toBe(true);
    expect(us.filter((u) => u.email === DOIS_TENANTS.emailRepetido).map((u) => u.tenant_id).sort()).toEqual([A, B].sort());
    const mods = (t: string) => dados['plataforma.tenant_modulo'].filter((m) => m.tenant_id === t).map((m) => m.modulo);
    expect(mods(A)).toEqual(['core', 'vendedor', 'promotor', 'teste', 'teste-dependente', 'catalogo']);
    expect(mods(B)).toEqual(['core', 'vendedor', 'catalogo']);
    const pm = (perfil: string) => dados['plataforma.perfil_modulo'].filter((p) => p.tenant_id === A && p.perfil === perfil).map((p) => p.modulo).sort();
    expect(pm('vendedor')).toEqual(['catalogo', 'core', 'teste', 'vendedor']);
    expect(pm('promotor')).toEqual(['core', 'promotor', 'teste']);
    expect(pm('supervisor')).toEqual(['catalogo', 'core', 'promotor', 'vendedor']);
    expect(pm('gerente')).toEqual(['catalogo', 'core', 'promotor', 'vendedor']);
    expect(pm('analista')).toEqual(['catalogo', 'core', 'promotor', 'vendedor']);
    expect(pm('assistente')).toEqual(['catalogo', 'core', 'vendedor']);
    // ADR 0005 / RN-CORE-03: em A e B, todo perfil com 'vendedor' também tem 'catalogo' (senão o Vendedor some)
    for (const t of [A, B]) {
      const linhas = dados['plataforma.perfil_modulo'].filter((p) => p.tenant_id === t);
      for (const { perfil } of linhas.filter((p) => p.modulo === 'vendedor')) {
        expect(linhas.some((p) => p.perfil === perfil && p.modulo === 'catalogo'), `${String(t).slice(0, 8)}/${String(perfil)}`).toBe(true);
      }
      expect(mods(t)).toContain('catalogo');
    }
    const exA = dados['plataforma.usuario_modulo'].filter((e) => e.tenant_id === A);
    expect(exA).toEqual([expect.objectContaining({ usuario_id: DOIS_TENANTS.A.usuarios.vendedor2, modulo: 'teste', efeito: 'remover' })]);
  });

  it('login (0004): sessões com sha256 hex do segredo exportado, aparelho do próprio usuário e tentativas zeradas', () => {
    for (const X of [DOIS_TENANTS.A, DOIS_TENANTS.B]) {
      expect(X.refresh.token).toBe(`${X.tenantId}.${X.refresh.segredo}`);
      expect(X.refresh.hash).toBe(crypto.createHash('sha256').update(X.refresh.segredo).digest('hex'));
      const s = dados['core.sessao'].filter((l) => l.tenant_id === X.tenantId);
      expect(s.map((l) => l.token_hash)).toEqual([X.refresh.hash]);
    }
    const aparelhos = new Map(dados['core.dispositivo'].map((d) => [d.id, d]));
    for (const s of dados['core.sessao']) expect(aparelhos.get(s.dispositivo_id)?.usuario_id).toBe(s.usuario_id);
    expect(aparelhos.get(DOIS_TENANTS.A.dispositivos.promotorBloqueado)?.bloqueado_em).not.toBeNull();
    expect(dados['core.usuario'].every((u) => u.tentativas_falhas === 0 && u.bloqueio_ate === null)).toBe(true);
  });

  it('vendedor-1 na equipe 1 e vendedor-2 na equipe 2, sob a regional do gerente', () => {
    const u = new Map(dados['core.usuario'].map((x) => [x.id, x]));
    expect(u.get(DOIS_TENANTS.A.usuarios.vendedor1)?.equipe_id).toBe(DOIS_TENANTS.A.equipes.equipe1);
    expect(u.get(DOIS_TENANTS.A.usuarios.vendedor2)?.equipe_id).toBe(DOIS_TENANTS.A.equipes.equipe2);
    const e = new Map(dados['core.equipe'].map((x) => [x.id, x]));
    expect(e.get(DOIS_TENANTS.A.equipes.equipe1)?.equipe_pai_id).toBe(DOIS_TENANTS.A.equipes.regional);
    expect(e.get(DOIS_TENANTS.A.equipes.regional)?.responsavel_id).toBe(DOIS_TENANTS.A.usuarios.gerente);
  });

  describe('Sprint 1 (com "hoje" fixo)', () => {
    const HOJE = '2026-11-03';
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { hoje: HOJE });
    const X = DOIS_TENANTS.A;

    it('cliente sem coordenada (c3) e com coordenada (c1, c2); carteiras sem mudança', () => {
      const c = new Map(d['core.cliente'].map((x) => [x.id, x]));
      expect(c.get(X.clientes.c3)?.latitude).toBeNull();
      expect(c.get(X.clientes.c1)?.latitude).not.toBeNull();
      expect(d['core.carteira']).toHaveLength(5);
    });

    it('rota de hoje com paradas; vendedor-1 com 2 paradas na própria carteira, em sequência', () => {
      expect(d['core.rota'].every((r) => r.data === HOJE)).toBe(true);
      const p = d['core.rota_parada'].filter((x) => x.rota_id === X.rotas.vendedor1).map((x) => [x.cliente_id, x.sequencia]);
      expect(p).toEqual([[X.clientes.c1, 1], [X.clientes.c3, 2]]);
      const carteira = new Set(d['core.carteira'].map((x) => `${x.usuario_id}:${x.cliente_id}`));
      for (const parada of d['core.rota_parada']) expect(carteira.has(`${parada.usuario_id}:${parada.cliente_id}`)).toBe(true);
    });

    it('títulos vencidos, a vencer e vencendo hoje; histórico de 12 meses de c1', () => {
      const t = d['core.titulo'].filter((x) => x.tenant_id === X.tenantId && x.situacao === 'aberto');
      expect(t.some((x) => String(x.vencimento) < HOJE)).toBe(true);
      expect(t.some((x) => String(x.vencimento) > HOJE)).toBe(true);
      expect(t.some((x) => x.vencimento === HOJE)).toBe(true);
      const h = d['core.historico_compra'].filter((x) => x.cliente_id === X.clientes.c1).map((x) => x.ano_mes);
      expect(h).toHaveLength(12);
      expect(h[0]).toBe('2025-12');
      expect(h[11]).toBe('2026-11');
    });

    it('uma visita aberta no máximo por usuário; cliente fechado com motivo de sistema e foto; uma notificação por usuário', () => {
      const abertas = d['core.visita'].filter((v) => v.checkout_em === null).map((v) => v.usuario_id);
      expect(new Set(abertas).size).toBe(abertas.length);
      const fechadas = d['core.visita'].filter((v) => v.resultado === 'cliente_fechado');
      expect(fechadas.map((v) => v.motivo_id).sort()).toEqual([X.motivos.lojaFechada, DOIS_TENANTS.B.motivos.acessoNegado].sort());
      expect(fechadas.every((v) => v.foto_fachada_id !== null)).toBe(true);
      const comNotificacao = new Set(d['core.notificacao'].map((n) => n.usuario_id));
      for (const u of d['core.usuario']) expect(comNotificacao.has(u.id), String(u.email)).toBe(true);
    });

    it('motivos padrão não estão nas listas (vêm do gatilho); ids batem com idDeChave', () => {
      expect(d['core.motivo'].map((m) => m.codigo)).toEqual(['obra_na_via', 'cliente_inadimplente']);
      expect(X.motivos.lojaFechada).toBe(idDeChave(`${X.tenantId}:core.motivo:cliente_fechado:loja_fechada`));
    });

    it('pedidos: totais = soma dos itens; status da lista do contrato', () => {
      for (const p of d['vendedor.pedido']) {
        const itens = d['vendedor.pedido_item'].filter((i) => i.pedido_id === p.id);
        expect(itens.reduce((s, i) => s + Number(i.total_cents), 0), String(p.id)).toBe(p.total_cents);
        expect(ORDER_STATUSES as readonly string[]).toContain(p.status);
      }
    });
  });
});

describe('seed Fase M (estático)', () => {
  const dados = dadosFaseM('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');

  it('S0-031 12 usuários da Fase M com o perfil mapeado', () => {
    const us = dados['core.usuario'].map((u) => `${u.email} ${u.perfil}`).sort();
    expect(us).toEqual(
      [
        'bruna@exemplo.com.br vendedor', 'rafael@exemplo.com.br vendedor', 'diego@exemplo.com.br vendedor', 'carla@exemplo.com.br vendedor',
        'marcos@exemplo.com.br vendedor', 'livia@exemplo.com.br vendedor', 'thiago@exemplo.com.br vendedor', 'paula@exemplo.com.br vendedor',
        'fernando@exemplo.com.br gerente', 'juliana@exemplo.com.br analista', 'ana@exemplo.com.br assistente', 'patricia@exemplo.com.br admin',
      ].sort(),
    );
    expect(dados['core.usuario'].every((u) => u.tenant_id === TENANT_FASE_M)).toBe(true);
  });

  it('S0-032 seis equipes sob a gerência do Fernando', () => {
    const eq = dados['core.equipe'];
    const raiz = eq.find((e) => e.equipe_pai_id === null)!;
    expect(raiz.responsavel_id).toBe(idDeterministico('fase-m:usuario:fernando@exemplo.com.br'));
    expect(eq.filter((e) => e.equipe_pai_id === raiz.id).map((e) => e.nome).sort()).toEqual(
      ['Centro', 'Interior', 'Zona Leste', 'Zona Norte', 'Zona Oeste', 'Zona Sul'],
    );
  });

  it('carteira aponta só para clientes e vendedores do seed', () => {
    const clientes = new Set(dados['core.cliente'].map((c) => c.id));
    const vendedores = new Set(dados['core.usuario'].filter((u) => u.perfil === 'vendedor').map((u) => u.id));
    for (const c of dados['core.carteira']) {
      expect(clientes.has(c.cliente_id)).toBe(true);
      expect(vendedores.has(c.usuario_id)).toBe(true);
    }
    expect(dados['core.produto']).toHaveLength(60);
  });
});

describe('utilitários', () => {
  it('idDeChave: UUID v5 com variante RFC 4122, estável (gêmeo de plataforma.uuid_de_chave)', () => {
    // valor de referência calculado pelo Postgres: select plataforma.uuid_de_chave('x')
    expect(idDeChave('x')).toBe('7f29305d-fba6-5e0d-a7cc-1ec3291e82ef');
    expect(idDeChave('y')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('idFixo e idDeterministico geram UUID válido e estável', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(idFixo('aaaaaaaa', 1, 7)).toBe('aaaaaaaa-0001-4000-8000-000000000007');
    expect(idDeterministico('x')).toMatch(uuid);
    expect(idDeterministico('x')).toBe(idDeterministico('x'));
    expect(idDeterministico('x')).not.toBe(idDeterministico('y'));
  });

  it.skipIf(!('argon2Sync' in crypto))('hash argon2id em PHC e verificação', () => {
    const h = hashSenha('Segredo@1');
    expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(verificarSenha('Segredo@1', h)).toBe(true);
    expect(verificarSenha('Outra@123', h)).toBe(false);
  });
});
