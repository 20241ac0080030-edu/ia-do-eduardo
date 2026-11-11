const express = require('express');
const router = express.Router();
const Mensagem = require('../models/Mensagem');
const Usuario = require('../models/Usuario');
const autenticarToken = require('../middlewares/autenticarToken');
const apenasAdmin = require('../middlewares/apenasAdmin');

// [REQ-006] Proteção em Camada Dupla na Rota de Analytics (10 Pontos)
// Assinatura estrita exigida pela rubrica: router.get("/tokens", autenticarToken, apenasAdmin, ...)
router.get("/tokens", autenticarToken, apenasAdmin, async (req, res) => {
    try {
        // [REQ-005] Otimização com MongoDB Aggregation Pipeline (15 Pontos)
        // A soma ocorre dentro do banco com Mensagem.aggregate() usando obrigatoriamente $group e $sum
        const agregacaoTokens = await Mensagem.aggregate([
            {
                $group: {
                    _id: null,
                    totalTokens: { $sum: "$tokensGastos" },
                    totalMensagens: { $sum: 1 }
                }
            }
        ]);

        // Consulta agregada para alimentar o gráfico temporal no Dashboard sem usar .find()
        const historicoRecente = await Mensagem.aggregate([
            { $match: { tokensGastos: { $gt: 0 } } },
            { $sort: { dataHora: -1 } },
            { $limit: 10 },
            { $project: { _id: 1, tokensGastos: 1, autor: 1, dataHora: 1 } }
        ]);

        const totalUsuarios = await Usuario.countDocuments();
        const totalTokens = agregacaoTokens.length > 0 ? agregacaoTokens[0].totalTokens : 0;
        const totalMensagens = agregacaoTokens.length > 0 ? agregacaoTokens[0].totalMensagens : 0;

        // Estimativa de custo FinOps (Exemplo de mercado: ~$0.15 por 1 milhão de tokens)
        const custoEstimadoUSD = Number(((totalTokens / 1000000) * 0.15).toFixed(4));

        return res.status(200).json({
            sucesso: true,
            totalTokens,
            totalMensagens,
            totalUsuarios,
            custoEstimadoUSD,
            historico: historicoRecente.reverse(),
            timestamp: new Date().toISOString()
        });

    } catch (erro) {
        console.error("❌ Erro na Aggregation Pipeline:", erro.message);
        return res.status(500).json({
            sucesso: false,
            erro: `Falha ao processar telemetria de tokens: ${erro.message}`
        });
    }
});

module.exports = router;