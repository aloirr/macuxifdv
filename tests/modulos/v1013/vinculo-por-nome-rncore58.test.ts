/**
 * RN-CORE-58 (vínculo automático por nome, R-20261115-110000/111500) e RN-CORE-60 (usuário nunca é excluído, só desativado).
 * Aceite com os casos do dono do produto e a costura: a carga do ERP decide pelo domínio e ninguém no Core grava `deleted_at`
 * em `core.usuario`. A carga no banco está em modules/core/api/vinculo-por-nome.db.test.ts (CI).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { existe, importar, ler, RAIZ } from '../apoio/v1013';

const DOMINIO = 'modules/core/domain/vinculo-por-nome.ts';
const CONSUMIDOR = 'modules/core/api/consumidores-erp-vendedor.ts';
const COM_VINCULO = existe(DOMINIO);

interface Candidato {
  id: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  external_id: string | null;
  email: string;
}
interface VinculoPorNome {
  normalizarNomeParaVinculo(n: string): string | null;
  decidirVinculoPorNome(nomeErp: string, usuarios: readonly Candidato[]): { acao: string; motivo?: string; usuario_id?: string };
}
const jose = (o: Partial<Candidato> = {}): Candidato => ({ id: 'u1', nome: 'Jose da Silva', perfil: 'vendedor', ativo: true, external_id: null, email: 'jose@exemplo.com.br', ...o });

describe('RN-CORE-58 — vínculo do vendedor do ERP pelo nome completo', () => {
  if (!COM_VINCULO) {
    it('antes do PR: a carga do ERP não procura usuário pelo nome', () => {
      expect(ler(CONSUMIDOR)).not.toContain('decidirVinculoPorNome');
    });
    return;
  }

  it('"JOSÉ  DA SILVA." casa com "Jose da Silva"; nome de uma palavra não vincula', async () => {
    const d = await importar<VinculoPorNome>(DOMINIO);
    expect(d.normalizarNomeParaVinculo('JOSÉ  DA SILVA.')).toBe(d.normalizarNomeParaVinculo('Jose da Silva'));
    expect(d.decidirVinculoPorNome('JOSÉ  DA SILVA.', [jose()])).toEqual({ acao: 'vincular', usuario_id: 'u1' });
    expect(d.decidirVinculoPorNome('José', [jose({ nome: 'José' })]).acao).toBe('seguir');
  });

  it('homônimo, outro código ERP e inativo não vinculam e avisam; provisório e supervisor nunca são candidatos', async () => {
    const d = await importar<VinculoPorNome>(DOMINIO);
    expect(d.decidirVinculoPorNome('Jose da Silva', [jose(), jose({ id: 'u2', perfil: 'promotor' })])).toMatchObject({ acao: 'avisar', motivo: 'homonimo' });
    expect(d.decidirVinculoPorNome('Jose da Silva', [jose({ external_id: 'V-9' })])).toMatchObject({ acao: 'avisar', motivo: 'outro_codigo' });
    expect(d.decidirVinculoPorNome('Jose da Silva', [jose({ ativo: false })])).toMatchObject({ acao: 'avisar', motivo: 'inativo' });
    expect(d.decidirVinculoPorNome('Jose da Silva', [jose({ email: 'erp-v9@sem-email.invalid' })]).acao).toBe('seguir');
    expect(d.decidirVinculoPorNome('Jose da Silva', [jose({ perfil: 'supervisor' })]).acao).toBe('seguir');
  });

  it('a carga do ERP usa a decisão do domínio depois da adoção por e-mail e antes de criar o provisório; o aviso não leva nome', () => {
    const c = ler(CONSUMIDOR);
    const decide = c.indexOf('decidirVinculoPorNome(nome, porNome)');
    expect(decide).toBeGreaterThan(c.indexOf('if (igual'));
    expect(c.indexOf('insert into core.usuario', decide)).toBeGreaterThan(decide);
    expect(c).toMatch(/update core\.usuario set external_id = \$2[^']*where id = \$1 and external_id is null/);
    expect(c).toMatch(/avisarVinculoPorNomeRecusado\(ctx, r\.external_id, decisao\.motivo, decisao\.candidatos\)/);
    expect(c).not.toMatch(/ctx\.log\.\w+\(\{[^}]*\bnome\b/);
  });
});

describe('RN-CORE-60 — usuário nunca é excluído, só desativado', () => {
  it('nenhum arquivo do Core grava deleted_at nem apaga linha em core.usuario', () => {
    const pastas = ['modules/core/api', 'modules/core/db', 'modules/core/domain'];
    const fontes = pastas.flatMap((p) =>
      readdirSync(join(RAIZ, p), { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => ({ f: `${p}/${f}`, src: ler(`${p}/${f}`) })),
    );
    expect(fontes.length).toBeGreaterThan(10);
    for (const { f, src } of fontes) {
      for (const m of src.matchAll(/update\s+core\.usuario\b(?:\s+\w+)?\s+set\s+([\s\S]*?)\bwhere\b/gi)) expect(m[1], f).not.toMatch(/deleted_at\s*=/);
      expect(src, f).not.toMatch(/delete\s+from\s+core\.usuario\b/i);
    }
  });

  it.skipIf(!existe('modules/core/api/vinculo-erp.ts'))('o vínculo manual (RN-CORE-58) desativa o provisório e tira dele o código ERP', () => {
    expect(ler('modules/core/api/vinculo-erp.ts')).toContain('update core.usuario set external_id = null, ativo = false');
  });
});
