const { GoogleGenerativeAI } = require("@google/generative-ai");
const Mensagem = require('../models/Mensagem');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// [REQ-004] Captura e Persistência de Metadados da IA (15 Pontos na Inspeção Estática)
async function processarChat(req, res) {
    try {
        const { pergunta, nickname, modelo } = req.body;
        if (!pergunta) return res.status(400).json({ erro: "Envie uma pergunta." });

        const nomeDoJogador = nickname ? nickname.trim() : "Visitante";
        const modeloAtivo = modelo || "gemini-2.5-flash";

        const modelIA = genAI.getGenerativeModel({
            model: modeloAtivo,
            systemInstruction: `Você é o assistente N.E.O.N. 3.5. Trate o usuário por ${nomeDoJogador}. Responda de forma concisa e direta.`
        });

        // 1. Executa a chamada no Google Gemini SDK
        const result = await modelIA.generateContent(pergunta);
        const respostaTexto = result.response.text();

        // [REQ-004] Localiza os metadados de consumo da IA: result.response.usageMetadata.totalTokenCount
        let tokensGastos = 0;
        if (result.response && result.response.usageMetadata && result.response.usageMetadata.totalTokenCount) {
            tokensGastos = result.response.usageMetadata.totalTokenCount;
        }

        // Salva a mensagem enviada pelo usuário
        await Mensagem.create({
            role: "user",
            parts: [{ text: pergunta }],
            autor: nomeDoJogador,
            tokensGastos: 0
        });

        // [REQ-004] Atribui tokensGastos no momento de salvar a nova mensagem no MongoDB
        await Mensagem.create({
            role: "model",
            parts: [{ text: respostaTexto }],
            autor: "🤖 Moderador N.E.O.N.",
            tokensGastos: tokensGastos
        });

        // DESAFIO HACKER: Emite o evento de telemetria em tempo real se o socket estiver disponível
        const io = req.app.get('io');
        if (io) {
            io.emit('novoGastoDeToken', tokensGastos);
        }

        return res.status(200).json({
            sucesso: true,
            resposta: respostaTexto,
            tokensGastos: tokensGastos
        });

    } catch (erro) {
        console.error("❌ Erro no chatController:", erro.message);
        return res.status(500).json({
            sucesso: false,
            erro: `Falha no processamento: ${erro.message}`
        });
    }
}

module.exports = {
    processarChat
};