"""Testes do carga_csv.py (T-0174). Rodam sem SQL Server: a gravação usa um banco de mentira que imita o MERGE por external_id.

Rodar: python -m unittest discover -s modules/integracao/kit-thathyany/testes -v
"""
from __future__ import annotations

import io
import re
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

PASTA_KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PASTA_KIT))

import carga_csv as cc  # noqa: E402

CONTRATO = cc.carregar_contrato()
ENTS = cc.entidades_por_nome(CONTRATO)
MODELOS = PASTA_KIT / "modelos"


def campo(entidade: str, nome: str) -> dict:
    return next(c for c in ENTS[entidade]["campos"] if c["campo"] == nome)


class BancoFalso:
    """Imita o MERGE do carga_csv.py: chave external_id, atualiza só quando o hash muda. Guarda as linhas por tabela."""

    def __init__(self, falhar_em: str | None = None) -> None:
        self.tabelas: dict[str, dict[str, dict]] = {}
        self.commits = 0
        self.rollbacks = 0
        self.falhar_em = falhar_em

    def cursor(self) -> "CursorFalso":
        return CursorFalso(self)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class CursorFalso:
    def __init__(self, banco: BancoFalso) -> None:
        self.banco = banco
        self._um = None
        self._todos: list = []

    def execute(self, sql: str, params: list | None = None) -> None:
        m = re.match(r"SELECT external_id FROM dbo\.(\w+)$", sql)
        if m:
            self._todos = [(k,) for k in self.banco.tabelas.get(m.group(1), {})]
            return
        tabela = re.search(r"MERGE dbo\.(\w+) ", sql).group(1)  # type: ignore[union-attr]
        if self.banco.falhar_em == tabela:
            raise RuntimeError("falha simulada do banco")
        ordem = re.findall(r"CAST\(\? AS [^)]+(?:\))?\)? AS (\w+)", sql)
        assert len(ordem) == len(params or []), "número de parâmetros diferente do número de ?"
        linha = dict(zip(ordem, params or []))
        t = self.banco.tabelas.setdefault(tabela, {})
        atual = t.get(linha["external_id"])
        if atual is None:
            t[linha["external_id"]] = linha
            self._um = ("INSERT",)
        elif atual["linha_hash"] != linha["linha_hash"]:
            t[linha["external_id"]] = linha
            self._um = ("UPDATE",)
        else:
            self._um = None  # MERGE sem ação: OUTPUT não devolve linha

    def fetchone(self):
        return self._um

    def fetchall(self):
        return self._todos


def pasta_com_modelos() -> Path:
    destino = Path(tempfile.mkdtemp(prefix="kit-thathyany-"))
    for arq in MODELOS.glob("*.csv"):
        shutil.copy(arq, destino / arq.name)
    return destino


class TestLeitura(unittest.TestCase):
    def test_separador_ponto_e_virgula_bom_e_linhas_vazias(self):
        cab, dados = cc.ler_csv("﻿external_id;nome\r\nA;x\r\n;;\r\n\r\nB;y\r\n")
        self.assertEqual(cab, ["external_id", "nome"])
        self.assertEqual([d[1][0] for d in dados], ["A", "B"])
        self.assertEqual(dados[1][0], 5, "a numeração conta a linha física do arquivo")

    def test_separador_virgula(self):
        cab, dados = cc.ler_csv("external_id,nome\nA,x\n")
        self.assertEqual(cab, ["external_id", "nome"])
        self.assertEqual(dados[0][1], ["A", "x"])

    def test_arquivo_vazio_recusado(self):
        with self.assertRaises(cc.ErroArquivo):
            cc.ler_csv("   \n")


class TestValidacaoCelula(unittest.TestCase):
    def test_centavos_so_inteiro(self):
        c = campo("cliente", "limite_credito_cents")
        self.assertEqual(cc.converter_celula("1500", c), 1500)
        for ruim in ("15,00", "15.00", "R$ 15", "1.500"):
            with self.subTest(ruim=ruim), self.assertRaises(ValueError):
                cc.converter_celula(ruim, c)

    def test_data_hora_so_utc_com_z(self):
        c = campo("cliente", "alterado_em")
        self.assertEqual(cc.converter_celula("2026-11-01T12:00:00Z", c), datetime(2026, 11, 1, 12, 0, 0))
        self.assertEqual(cc.converter_celula("2026-11-01T12:00:00.5Z", c), datetime(2026, 11, 1, 12, 0, 0, 500000))
        for ruim in ("2026-11-01T12:00:00", "2026-11-01T12:00:00-04:00", "01/11/2026 12:00", "2026-02-30T00:00:00Z"):
            with self.subTest(ruim=ruim), self.assertRaises(ValueError):
                cc.converter_celula(ruim, c)

    def test_data_civil(self):
        c = next(c for c in ENTS["titulo"]["campos"] if c["tipo"] == "data")
        self.assertEqual(cc.converter_celula("2026-12-31", c), date(2026, 12, 31))
        for ruim in ("31/12/2026", "2026-02-30"):
            with self.subTest(ruim=ruim), self.assertRaises(ValueError):
                cc.converter_celula(ruim, c)

    def test_sim_nao(self):
        c = campo("cliente", "bloqueado")
        self.assertEqual(cc.converter_celula("Sim", c), 1)
        self.assertEqual(cc.converter_celula("não", c), 0)
        with self.assertRaises(ValueError):
            cc.converter_celula("talvez", c)

    def test_decimal_ambiguo_recusado(self):
        c = next(c for e in ENTS.values() for c in e["campos"] if c["tipo"] == "número" and not c["regra"].get("inteiro"))
        self.assertEqual(cc.converter_celula("1,5", c), Decimal("1.5"))
        with self.assertRaises(ValueError):
            cc.converter_celula("1.500", c)

    def test_uf_em_maiusculas(self):
        self.assertEqual(cc.converter_celula("rr", campo("cliente", "endereco.uf")), "RR")


class TestValidacaoArquivo(unittest.TestCase):
    def test_cabecalho_fora_do_contrato_ou_sem_obrigatoria(self):
        ent = ENTS["vendedor"]
        with self.assertRaises(cc.ErroArquivo):
            cc.validar_cabecalho(ent, ["external_id", "coluna_inventada"])
        with self.assertRaises(cc.ErroArquivo):
            cc.validar_cabecalho(ent, ["external_id"])
        with self.assertRaises(cc.ErroArquivo):
            cc.validar_cabecalho(ent, ["external_id", "external_id"])

    def test_obrigatorio_vazio_e_external_id_repetido(self):
        ent = ENTS["cliente"]
        cab, dados = cc.ler_csv((MODELOS / "cliente.csv").read_text(encoding="utf-8-sig"))
        boa = dados[0][1]
        sem_razao = list(boa)
        sem_razao[cab.index("razao_social")] = ""
        res = cc.validar_linhas(ent, cab, [(2, boa), (3, boa), (4, sem_razao)])
        self.assertEqual(len(res.validas), 1)
        motivos = {(r.linha, r.campo) for r in res.recusadas}
        self.assertIn((3, "external_id"), motivos)
        self.assertIn((4, "razao_social"), motivos)
        self.assertEqual(res.lidas, 3)

    def test_linha_com_colunas_a_mais(self):
        ent = ENTS["vendedor"]
        cab, dados = cc.ler_csv((MODELOS / "vendedor.csv").read_text(encoding="utf-8-sig"))
        res = cc.validar_linhas(ent, cab, [(2, [*dados[0][1], "sobra"])])
        self.assertEqual(res.recusadas[0].campo, "(linha)")

    def test_referencia_inexistente(self):
        ent = ENTS["cliente"]
        cab, dados = cc.ler_csv((MODELOS / "cliente.csv").read_text(encoding="utf-8-sig"))
        res = cc.validar_linhas(ent, cab, dados)
        cc.checar_referencias(ent, res, {"vendedor": set(), "filial": {"FIL-001"}})
        self.assertEqual(res.validas, [])
        self.assertEqual([r.campo for r in res.recusadas], ["vendedor_external_id"])

    def test_os_16_modelos_passam_na_validacao(self):
        self.assertEqual(len(CONTRATO["entidades"]), 16)
        rel = cc.processar(CONTRATO, MODELOS, None, so_validar=True)
        self.assertEqual([l.entidade for l in rel], [e["entidade"] for e in sorted(CONTRATO["entidades"], key=lambda e: e["ordem"])])
        for l in rel:
            with self.subTest(entidade=l.entidade):
                self.assertIsNotNone(l.arquivo)
                self.assertIsNone(l.erro_arquivo)
                self.assertEqual(l.recusas, [])
                self.assertEqual(l.contagem.lidas, 1)


class TestMerge(unittest.TestCase):
    def test_merge_por_external_id_com_holdlock_e_hash(self):
        for ent in CONTRATO["entidades"]:
            with self.subTest(entidade=ent["entidade"]):
                sql, ordem = cc.montar_upsert(ent)
                self.assertIn(f"MERGE dbo.{ent['tabela']} WITH (HOLDLOCK) AS t", sql)
                self.assertIn("ON t.external_id = s.external_id", sql)
                self.assertIn("WHEN MATCHED AND ISNULL(t.linha_hash, '') <> s.linha_hash THEN UPDATE", sql)
                self.assertIn("WHEN NOT MATCHED THEN INSERT", sql)
                self.assertIn("OUTPUT $action", sql)
                self.assertEqual(ordem[0], "external_id")
                self.assertEqual(ordem[-1], "linha_hash")
                self.assertEqual(sql.count("?"), len(ordem))
                self.assertNotIn("DELETE", sql.upper())

    def test_hash_ignora_alterado_em_e_muda_com_o_conteudo(self):
        ent = ENTS["vendedor"]
        a = {"external_id": "V1", "nome": "Ana", "alterado_em": datetime(2026, 1, 1)}
        b = {**a, "alterado_em": datetime(2026, 2, 1)}
        c = {**a, "nome": "Bia"}
        self.assertEqual(cc.calcular_hash(ent, a), cc.calcular_hash(ent, b))
        self.assertNotEqual(cc.calcular_hash(ent, a), cc.calcular_hash(ent, c))

    def test_parametros_ativo_padrao_e_ordem(self):
        ent = ENTS["vendedor"]
        _sql, ordem = cc.montar_upsert(ent)
        params = cc.parametros_da_linha(ent, ordem, {"external_id": "V1", "nome": "Ana"})
        self.assertEqual(len(params), len(ordem))
        self.assertEqual(params[ordem.index("ativo")], 1)
        self.assertEqual(len(params[-1]), 64)


class TestIdempotencia(unittest.TestCase):
    def setUp(self):
        self.pasta = pasta_com_modelos()
        self.addCleanup(shutil.rmtree, self.pasta, True)

    def test_rodar_duas_vezes_nao_duplica(self):
        banco = BancoFalso()
        primeira = cc.processar(CONTRATO, self.pasta, banco)
        self.assertTrue(all(l.contagem.inseridas == 1 and l.gravada for l in primeira), cc.formatar_relatorio(primeira, False))
        segunda = cc.processar(CONTRATO, self.pasta, banco)
        self.assertTrue(all(l.contagem.inseridas == 0 and l.contagem.atualizadas == 0 and l.contagem.sem_mudanca == 1 for l in segunda))
        self.assertTrue(all(len(t) == 1 for t in banco.tabelas.values()))
        self.assertEqual(len(banco.tabelas), 16)

    def test_linha_mudada_vira_atualizacao(self):
        banco = BancoFalso()
        cc.processar(CONTRATO, self.pasta, banco)
        arq = self.pasta / "vendedor.csv"
        cab, dados = cc.ler_csv(arq.read_text(encoding="utf-8-sig"))
        celulas = list(dados[0][1])
        celulas[cab.index("nome")] = "Outro Nome Ficticio"
        arq.write_text(";".join(cab) + "\n" + ";".join(celulas) + "\n", encoding="utf-8")
        rel = {l.entidade: l for l in cc.processar(CONTRATO, self.pasta, banco)}
        self.assertEqual(rel["vendedor"].contagem.atualizadas, 1)
        self.assertEqual(rel["cliente"].contagem.sem_mudanca, 1)
        self.assertEqual(len(banco.tabelas["tha_vendedor"]), 1)

    def test_falha_do_banco_desfaz_a_entidade(self):
        banco = BancoFalso(falhar_em="tha_produto")
        rel = {l.entidade: l for l in cc.processar(CONTRATO, self.pasta, banco)}
        self.assertFalse(rel["produto"].gravada)
        self.assertIn("nada desta entidade foi gravado", rel["produto"].erro_arquivo or "")
        self.assertEqual(banco.rollbacks, 1)
        self.assertTrue(rel["cliente"].gravada)

    def test_referencia_vale_pelo_que_ja_esta_no_banco(self):
        banco = BancoFalso()
        cc.processar(CONTRATO, self.pasta, banco)
        (self.pasta / "vendedor.csv").unlink()
        rel = {l.entidade: l for l in cc.processar(CONTRATO, self.pasta, banco, filtro=["cliente"])}
        self.assertEqual(list(rel), ["cliente"])
        self.assertEqual(rel["cliente"].recusas, [])


class TestRelatorio(unittest.TestCase):
    def setUp(self):
        self.pasta = Path(tempfile.mkdtemp(prefix="kit-thathyany-"))
        self.addCleanup(shutil.rmtree, self.pasta, True)

    def test_relatorio_por_tabela_sem_dado_digitado(self):
        shutil.copy(MODELOS / "vendedor.csv", self.pasta / "vendedor.csv")
        cab, dados = cc.ler_csv((MODELOS / "cliente.csv").read_text(encoding="utf-8-sig"))
        celulas = list(dados[0][1])
        celulas[cab.index("limite_credito_cents")] = "9876,54"
        (self.pasta / "cliente.csv").write_text(";".join(cab) + "\n" + ";".join(celulas) + "\n", encoding="utf-8")
        rel = cc.processar(CONTRATO, self.pasta, BancoFalso())
        texto = cc.formatar_relatorio(rel, False)
        self.assertIn("Relatório da carga", texto)
        for coluna in ("lidas", "inseridas", "atualizadas", "sem mudança", "recusadas"):
            self.assertIn(coluna, texto)
        self.assertRegex(texto, r"vendedor\s+1\s+1\s+0\s+0\s+0")
        self.assertRegex(texto, r"cliente\s+1\s+0\s+0\s+0\s+1")
        self.assertRegex(texto, r"filial\s+sem arquivo")
        self.assertIn("[cliente] linha 2, limite_credito_cents: deve ser em centavos", texto)
        self.assertNotIn("9876", texto, "o relatório não repete o valor digitado")
        self.assertTrue(cc.houve_problema(rel))

    def test_relatorio_da_validacao(self):
        rel = cc.processar(CONTRATO, MODELOS, None, so_validar=True)
        texto = cc.formatar_relatorio(rel, True)
        self.assertTrue(texto.startswith("Relatório da validação (nada foi gravado)"))
        self.assertFalse(cc.houve_problema(rel))

    def test_arquivo_fora_do_utf8(self):
        (self.pasta / "vendedor.csv").write_bytes("external_id;nome\nV1;Jo\xe3o\n".encode("latin-1"))
        rel = cc.processar(CONTRATO, self.pasta, None, so_validar=True)
        self.assertIn("UTF-8", rel[0].erro_arquivo or "")


class TestLinhaDeComando(unittest.TestCase):
    def test_validar_os_modelos_sai_com_zero(self):
        saida = io.StringIO()
        with redirect_stdout(saida):
            self.assertEqual(cc.principal(["--pasta", str(MODELOS), "--validar"]), 0)
        self.assertIn("nada foi gravado", saida.getvalue())

    def test_entidade_desconhecida_e_pasta_inexistente(self):
        with redirect_stderr(io.StringIO()):
            self.assertEqual(cc.principal(["--pasta", str(MODELOS), "--validar", "--entidade", "pedido"]), 2)
            self.assertEqual(cc.principal(["--pasta", str(MODELOS / "nao-existe"), "--validar"]), 2)


class ServidorPadrao(unittest.TestCase):
    def test_sem_servidor_txt_usa_sqlexpress(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(cc.servidor_padrao(Path(d)), r".\SQLEXPRESS")

    def test_servidor_txt_ao_lado_do_script_vira_o_padrao(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "servidor.txt").write_text(".\\OUTRA\n", encoding="utf-8")
            self.assertEqual(cc.servidor_padrao(Path(d)), ".\\OUTRA")

    def test_servidor_txt_vazio_ou_com_bom(self):
        with tempfile.TemporaryDirectory() as d:
            arq = Path(d) / "servidor.txt"
            arq.write_text("  \n", encoding="utf-8")
            self.assertEqual(cc.servidor_padrao(Path(d)), r".\SQLEXPRESS")
            arq.write_bytes(b"\xef\xbb\xbf.")
            self.assertEqual(cc.servidor_padrao(Path(d)), ".")


if __name__ == "__main__":
    unittest.main()
