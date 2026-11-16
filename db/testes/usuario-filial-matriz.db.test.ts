/**
 * 0085 — filial MATRIZ para o usuário sem filial de cadastro (v1.0.14, RN-CORE-39; R-20261116-093600-alexandre).
 * Dicionário: docs/banco/core.md, "0085". Critério da matriz no cabeçalho da migração: viva e ativa; CNPJ /0001 primeiro; empate e
 * tenant sem /0001 = menor código (numérico antes, depois texto, depois id); tenant sem filial viva e ativa = nada muda.
 * Estático sempre; up, idempotência, isolamento e down num banco efêmero.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { semBanco } from './estado';
import { retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m = migracoes.find((x) => x.nome === 'core_usuario_filial_matriz')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const umaLinha = (s: string) => s.replace(/\s+/g, ' ').trim();
const up = umaLinha(semComentarios(m.up));
const down = umaLinha(semComentarios(m.down));

describe('0085 filial matriz do usuário sem filial (estático)', () => {
  it('existe, depois da 0084 e com caminho de volta', () => {
    expect(m).toBeTruthy();
    expect(m.versao).toBe('0085');
    expect(m.up).toContain('R-20261116-093600-alexandre');
  });

  it('só dados: nenhum DDL, grant, RLS ou set_config; nada de desligar gatilho', () => {
    expect(up).not.toMatch(/\b(create|alter|drop|grant|revoke|truncate|delete)\b/i);
    expect(up).not.toMatch(/set_config|row_security|session_replication_role|disable trigger/i);
  });

  it('matriz: viva e ativa, CNPJ só dígitos /0001 primeiro, depois menor código (numérico antes) e id', () => {
    expect(up).toContain("where f.deleted_at is null and f.ativo");
    expect(up).toContain("regexp_replace(coalesce(f.cnpj, ''), '[^0-9]', '', 'g')");
    expect(up).toContain("(char_length(fv.cnpj_digitos) = 14 and substr(fv.cnpj_digitos, 9, 4) = '0001') desc");
    expect(up).toContain("(fv.codigo ~ '^[0-9]+$') desc, case when fv.codigo ~ '^[0-9]+$' then fv.codigo::numeric end, fv.codigo, fv.id");
  });

  it('só usuário vivo sem cadastro; grava venda (invariante da 0077) e cadastro com updated_at', () => {
    expect(up).toContain('where u.deleted_at is null and u.filial_cadastro_id is null');
    expect(up).toContain('insert into core.usuario_filial (tenant_id, usuario_id, filial_id)');
    expect(up).toContain('set filial_cadastro_id = a.filial_id, updated_at = now()');
    expect(up).toMatch(/and u\.filial_cadastro_id is null;$/);
  });

  it('down: no-op documentado, não mexe em dados nem no catálogo', () => {
    expect(down).toBe('select 1;');
    expect(m.down).toContain('NO-OP');
  });
});

describe.skipIf(semBanco())('0085 filial matriz (banco efêmero)', () => {
  let b: BancoDeTeste;
  const id = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
  // tenants
  const T1 = id(1); // tem /0001 (duas raízes: empate pelo código)
  const T2 = id(2); // sem /0001: menor código entre vivas e ativas
  const T3 = id(3); // sem filial viva e ativa
  // filiais de T1
  const F1_MAO = id(101); // 0002, /0001 -> matriz
  const F1_OUTRA_0001 = id(102); // 0010, /0001 de outra raiz (perde no código)
  const F1_BV = id(103); // 0003, /0002
  const F1_INATIVA = id(104); // 0000, /0001 inativa
  const F1_APAGADA = id(105); // 00, /0001 apagada
  // filiais de T2
  const F2_10 = id(201);
  const F2_9 = id(202); // matriz: 9 antes de 10 (numérico)
  const F2_8_INATIVA = id(203);
  const F2_7_APAGADA = id(204);
  const F2_A = id(205);
  // usuários
  const U1_COM = id(1001);
  const U1_SEM = id(1002);
  const U1_SEM_COM_VENDA = id(1003);
  const U1_INATIVO = id(1004);
  const U1_APAGADO = id(1005);
  const U2_SEM = id(2001);
  const U3_SEM = id(3001);

  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('matriz /0001 ou menor código; quem tem filial fica; apagado fica; tenant sem filial ativa fica; idempotente; down no-op', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: migracoes[migracoes.indexOf(m) - 1]!.versao });
      const q = (sql: string, p: unknown[] = []) => c.query(sql, p);

      for (const [t, cod] of [[T1, 'mat87a'], [T2, 'mat87b'], [T3, 'mat87c']] as const) {
        await q('insert into plataforma.tenant (id, codigo, nome) values ($1, $2, $3)', [t, cod, `Tenant ${cod}`]);
      }
      // T1: a padrão semeada (código 0001, sem CNPJ) perde para a /0001
      const filial = (f: string, t: string, codigo: string, cnpj: string | null, ativo = true) =>
        q('insert into core.filial (id, tenant_id, codigo, nome, cnpj, ativo) values ($1, $2, $3, $4, $5, $6)', [f, t, codigo, `Filial ${codigo}`, cnpj, ativo]);
      await filial(F1_MAO, T1, '0002', '12345678000195');
      await filial(F1_OUTRA_0001, T1, '0010', '98765432000110');
      await filial(F1_BV, T1, '0003', '12345678000276');
      await filial(F1_INATIVA, T1, '0000', '11111111000111', false);
      await filial(F1_APAGADA, T1, '00', '22222222000122');
      await q('update core.filial set deleted_at = now() where id = $1', [F1_APAGADA]);
      // T2: sem /0001; a padrão vira código 20
      await q("update core.filial set codigo = '20' where tenant_id = $1 and padrao", [T2]);
      await filial(F2_10, T2, '10', '33333333000233');
      await filial(F2_9, T2, '9', null);
      await filial(F2_8_INATIVA, T2, '8', null, false);
      await filial(F2_7_APAGADA, T2, '7', null);
      await q('update core.filial set deleted_at = now() where id = $1', [F2_7_APAGADA]);
      await filial(F2_A, T2, 'A', null);
      // T3: a padrão deixa de ser padrão e fica inativa (nenhuma viva e ativa)
      await q('update core.filial set padrao = false, ativo = false where tenant_id = $1', [T3]);

      const usuario = (u: string, t: string, email: string, ativo = true) =>
        q("insert into core.usuario (id, tenant_id, nome, email, perfil, ativo) values ($1, $2, 'Teste 0085', $3, 'vendedor', $4)", [u, t, email, ativo]);
      await usuario(U1_COM, T1, 'com87@exemplo.com.br');
      await usuario(U1_SEM, T1, 'sem87@exemplo.com.br');
      await usuario(U1_SEM_COM_VENDA, T1, 'venda87@exemplo.com.br');
      await usuario(U1_INATIVO, T1, 'inativo87@exemplo.com.br', false);
      await usuario(U1_APAGADO, T1, 'apagado87@exemplo.com.br');
      await q('update core.usuario set deleted_at = now() where id = $1', [U1_APAGADO]);
      await usuario(U2_SEM, T2, 'sem87b@exemplo.com.br');
      await usuario(U3_SEM, T3, 'sem87c@exemplo.com.br');
      // U1_COM: cadastro e venda em BV (venda antes do cadastro: a invariante da 0077 confere no COMMIT de cada comando)
      await q('insert into core.usuario_filial (tenant_id, usuario_id, filial_id) values ($1, $2, $3)', [T1, U1_COM, F1_BV]);
      await q('update core.usuario set filial_cadastro_id = $2 where id = $1', [U1_COM, F1_BV]);
      // U1_SEM_COM_VENDA: venda em BV, sem cadastro
      await q('insert into core.usuario_filial (tenant_id, usuario_id, filial_id) values ($1, $2, $3)', [T1, U1_SEM_COM_VENDA, F1_BV]);

      const retratoUsuarios = async () =>
        (await q("select id, filial_cadastro_id, updated_at from core.usuario where tenant_id in ($1, $2, $3) order by id", [T1, T2, T3])).rows as {
          id: string;
          filial_cadastro_id: string | null;
          updated_at: Date;
        }[];
      const retratoVendas = async () =>
        (await q('select tenant_id, usuario_id, filial_id, deleted_at, updated_at from core.usuario_filial where tenant_id in ($1, $2, $3) order by usuario_id, filial_id', [T1, T2, T3])).rows;
      const antes = new Map((await retratoUsuarios()).map((r) => [r.id, r]));
      const catalogoAntes = await retratoDoCatalogo(c);

      expect((await migrarUp(c, { ate: m.versao })).aplicadas).toEqual([`${m.versao}_${m.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(catalogoAntes); // só dados

      const depois = new Map((await retratoUsuarios()).map((r) => [r.id, r]));
      const cadastro = (u: string) => depois.get(u)!.filial_cadastro_id;
      const andou = (u: string) => depois.get(u)!.updated_at.getTime() > antes.get(u)!.updated_at.getTime();
      // T1: /0001 viva e ativa de menor código
      expect(cadastro(U1_SEM)).toBe(F1_MAO);
      expect(cadastro(U1_SEM_COM_VENDA)).toBe(F1_MAO);
      expect(cadastro(U1_INATIVO)).toBe(F1_MAO);
      expect(andou(U1_SEM) && andou(U1_SEM_COM_VENDA) && andou(U1_INATIVO)).toBe(true);
      // quem já tinha filial e o apagado não mudam
      expect(depois.get(U1_COM)).toEqual(antes.get(U1_COM));
      expect(depois.get(U1_APAGADO)).toEqual(antes.get(U1_APAGADO));
      // T2: sem /0001, menor código numérico entre vivas e ativas (9 antes de 10; 8 inativa e 7 apagada fora)
      expect(cadastro(U2_SEM)).toBe(F2_9);
      expect(andou(U2_SEM)).toBe(true);
      // T3: sem filial viva e ativa, nada muda
      expect(depois.get(U3_SEM)).toEqual(antes.get(U3_SEM));

      // vendas: a matriz entra como venda (invariante da 0077); a venda que já existia fica
      const vendas = async (u: string) =>
        (await q('select filial_id from core.usuario_filial where usuario_id = $1 and deleted_at is null order by filial_id', [u])).rows.map((r) => (r as { filial_id: string }).filial_id);
      expect(await vendas(U1_SEM)).toEqual([F1_MAO]);
      expect(await vendas(U1_SEM_COM_VENDA)).toEqual([F1_MAO, F1_BV].sort());
      expect(await vendas(U1_INATIVO)).toEqual([F1_MAO]);
      expect(await vendas(U1_COM)).toEqual([F1_BV]);
      expect(await vendas(U1_APAGADO)).toEqual([]);
      expect(await vendas(U2_SEM)).toEqual([F2_9]);
      expect(await vendas(U3_SEM)).toEqual([]);

      // isolamento: filial de cadastro e de venda sempre do tenant do usuário
      const cruzados = await q(
        `select count(*)::int as n from core.usuario u join core.filial f on f.id = u.filial_cadastro_id where f.tenant_id <> u.tenant_id
         union all
         select count(*)::int from core.usuario_filial uf join core.filial f on f.id = uf.filial_id where f.tenant_id <> uf.tenant_id`,
      );
      expect(cruzados.rows).toEqual([{ n: 0 }, { n: 0 }]);

      // idempotente: rodar o up de novo não muda nada
      const usuarios1 = await retratoUsuarios();
      const vendas1 = await retratoVendas();
      await q(m.up);
      expect(await retratoUsuarios()).toEqual(usuarios1);
      expect(await retratoVendas()).toEqual(vendas1);

      // down: no-op (catálogo e dados ficam); up de novo também não muda nada
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${m.versao}_${m.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(catalogoAntes);
      expect(await retratoUsuarios()).toEqual(usuarios1);
      expect(await retratoVendas()).toEqual(vendas1);
      await migrarUp(c, { ate: m.versao });
      expect(await retratoUsuarios()).toEqual(usuarios1);
      expect(await retratoVendas()).toEqual(vendas1);
    });
  });
});
