require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mongoose = require('mongoose');
const multer = require('multer');
const pdfModule = require('pdf-parse');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

// Configuração do Multer para processar arquivos exclusivamente na memória RAM (sem salvar em disco)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Limite de até 10 MB
});

// Chave secreta para assinatura dos tokens JWT
const JWT_SECRET = process.env.JWT_SECRET || 'neon_secret_jwt_corporativo_2026';

// Memórias de contingência caso o MongoDB esteja temporariamente inacessível
let memoriaContingencia = [];
let documentosContingencia = {};

// ====================================================================
// FUNÇÃO UNIVERSAL DE EXTRAÇÃO DE PDF (COMPATÍVEL COM V1 E V2)
// ====================================================================
async function extrairTextoPDF(buffer) {
    try {
        // 1. Se for a versão 1 do pdf-parse (função direta)
        if (typeof pdfModule === 'function') {
            const dados = await pdfModule(buffer);
            return dados.text;
        }
        // 2. Se for exportada como .default
        if (pdfModule && typeof pdfModule.default === 'function') {
            const dados = await pdfModule.default(buffer);
            return dados.text;
        }
        // 3. Se for a versão 2 do pdf-parse (Classe PDFParse)
        if (pdfModule && pdfModule.PDFParse) {
            const parser = new pdfModule.PDFParse({ data: buffer });
            const resultado = await parser.getText();
            return resultado.text;
        }
        // 4. Fallback para construtor direto da v2
        if (typeof pdfModule === 'object') {
            const Construtor = pdfModule.PDFParse || pdfModule;
            const parser = new Construtor({ data: buffer });
            if (typeof parser.getText === 'function') {
                const resultado = await parser.getText();
                return resultado.text;
            }
        }
    } catch (err) {
        console.error("❌ Erro interno ao extrair texto do PDF:", err.message);
        throw new Error(`Falha na extração do PDF: ${err.message}`);
    }

    throw new Error("Incompatibilidade na versão da biblioteca pdf-parse instalada.");
}

// ====================================================================
// 1. CONEXÃO COM O BANCO DE DADOS MONGODB
// ====================================================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📦 BANCO DE DADOS ATIVO!'))
  .catch((err) => console.error('❌ ERRO MONGO (Modo de Contingência Ativo):', err.message));

// Modelo de Memória do Chat
const MensagemSchema = new mongoose.Schema({
    role: String,
    parts: [{ text: String }],
    dataHora: { type: Date, default: Date.now }
});
const MensagemDbModel = mongoose.model('MemoriaSessao', MensagemSchema);

// Schema de Jogador com XP (Gamificação)
const JogadorSchema = new mongoose.Schema({
    nome: { type: String, unique: true, required: true },
    xp: { type: Number, default: 0 }
});
const JogadorModel = mongoose.model('Jogador', JogadorSchema);

// Schema para RAG Persistente (Desafio Hacker)
const DocumentoSessaoSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    nomeArquivo: { type: String, required: true },
    conteudoTexto: { type: String, required: true },
    dataUpload: { type: Date, default: Date.now }
});
const DocumentoSessaoModel = mongoose.model('DocumentoSessao', DocumentoSessaoSchema);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ====================================================================
// 2. MIDDLEWARE DE SEGURANÇA (CATRACA DIGITAL JWT)
// ====================================================================
function verificarTokenJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    // Se o cabeçalho não existir ou não começar com Bearer
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            sucesso: false, 
            erro: "401 Unauthorized: Acesso negado. Token JWT ausente no cabeçalho Authorization." 
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const dadosDecodificados = jwt.verify(token, JWT_SECRET);
        req.usuarioAuth = dadosDecodificados;
        next();
    } catch (err) {
        return res.status(401).json({ 
            sucesso: false, 
            erro: "401 Unauthorized: Token JWT inválido ou expirado." 
        });
    }
}

// ====================================================================
// 3. FERRAMENTAS DO AGENTE (FUNCTION CALLING)
// ====================================================================

async function adicionarXP(nickname, quantidade) {
    try {
        const nomeFormatado = nickname.trim();
        if (!nomeFormatado) return { erro: "Nickname inválido para receber pontuação." };

        const jogador = await JogadorModel.findOneAndUpdate(
            { nome: nomeFormatado },
            { $inc: { xp: quantidade } },
            { new: true, upsert: true }
        );

        return {
            nickname: jogador.nome,
            xpAtual: jogador.xp,
            quantidadeAlterada: quantidade,
            mensagem: `XP de ${jogador.nome} atualizado. XP Atual: ${jogador.xp}`
        };
    } catch (error) {
        return { erro: `Falha ao processar XP: ${error.message}` };
    }
}

async function buscarClimaTempoReal(cidade) {
    try {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) return { erro: "Chave de API do clima não configurada no servidor." };
        
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cidade)}&units=metric&lang=pt_br&appid=${apiKey}`;
        const response = await fetch(url);
        if (!response.ok) return { erro: `Cidade '${cidade}' não localizada.` };
        
        const data = await response.json();
        return {
            cidade: data.name,
            temperatura: `${Math.round(data.main.temp)}°C`,
            sensacaoTermica: `${Math.round(data.main.feels_like)}°C`,
            clima: data.weather[0].description,
            umidade: `${data.main.humidity}%`
        };
    } catch (error) {
        return { erro: `Erro de clima: ${error.message}` };
    }
}

async function converterMoedas(valor, de, para) {
    try {
        const from = de.toUpperCase();
        const to = para.toUpperCase();
        if (from === to) return { valorOriginal: valor, moedaOrigem: from, moedaDestino: to, valorConvertido: valor };
        
        const url = `https://api.frankfurter.app/latest?amount=${valor}&from=${from}&to=${to}`;
        const response = await fetch(url);
        if (!response.ok) return { erro: `Falha ao converter moedas de ${from} para ${to}.` };
        
        const data = await response.json();
        const resultado = data.rates[to];
        return {
            valorOriginal: valor,
            moedaOrigem: from,
            moedaDestino: to,
            valorConvertido: resultado.toFixed(2),
            dataCotacao: data.date
        };
    } catch (error) {
        return { erro: `Erro na conversão: ${error.message}` };
    }
}

// Declarações JSON Schema para o Gemini
const declaracaoXP = {
    name: "adicionarXP",
    description: "Adiciona ou remove pontos de Experiência (XP) de um usuário baseado no seu nickname.",
    parameters: {
        type: "OBJECT",
        properties: {
            nickname: { type: "STRING", description: "O apelido do jogador." },
            quantidade: { type: "INTEGER", description: "Pontos para somar ou subtrair." }
        },
        required: ["nickname", "quantidade"]
    }
};

const declaracaoClima = {
    name: "buscarClimaTempoReal",
    description: "Obtém a temperatura exata e o clima atual de uma cidade.",
    parameters: {
        type: "OBJECT",
        properties: {
            cidade: { type: "STRING", description: "Nome da cidade." }
        },
        required: ["cidade"]
    }
};

const declaracaoMoeda = {
    name: "converterMoedas",
    description: "Converte valores financeiros entre moedas internacionais.",
    parameters: {
        type: "OBJECT",
        properties: {
            valor: { type: "NUMBER", description: "Valor a ser convertido." },
            de: { type: "STRING", description: "Moeda de origem com 3 letras." },
            para: { type: "STRING", description: "Moeda de destino com 3 letras." }
        },
        required: ["valor", "de", "para"]
    }
};

// ====================================================================
// 4. ROTAS HTTP
// ====================================================================

// SPRINT 5: Rota de Health Check (Pública)
app.get('/api/health', (req, res) => {
    const estadoMongo = mongoose.connection.readyState;
    const statusBanco = estadoMongo === 1 ? "conectado" : "desconectado/contingencia";

    return res.status(200).json({
        status: "ok",
        servidor: "operacional",
        bancoDeDados: statusBanco,
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(process.uptime())} segundos`
    });
});

// SPRINT 6: Rota para Emissão de Token JWT de Teste (Pública)
app.post('/api/auth/token', (req, res) => {
    const { nickname } = req.body;
    const usuario = nickname ? nickname.trim() : "Operador_Anonimo";
    
    // Gera token válido por 24 horas
    const token = jwt.sign({ nickname: usuario, cargo: "Analista_Corporativo" }, JWT_SECRET, { expiresIn: '24h' });
    return res.status(200).json({ sucesso: true, token });
});

// SPRINT 6: Rota RAG com Leitura de Documentos (PROTEGIDA POR JWT)
app.post('/api/chat/documento', verificarTokenJWT, upload.single('documento'), async (req, res) => {
    try {
        const { pergunta, nickname, modelo } = req.body;
        if (!pergunta) return res.status(400).json({ erro: "Envie uma pergunta sobre o documento." });

        const nomeOperador = nickname ? nickname.trim() : (req.usuarioAuth?.nickname || "Operador");
        const modeloAtivo = modelo || "gemini-2.5-flash";

        let textoDocumento = "";
        let nomeDoArquivo = "";

        // 1. Extração na Memória RAM se um novo arquivo for enviado
        if (req.file) {
            nomeDoArquivo = req.file.originalname;

            if (req.file.mimetype === 'application/pdf' || nomeDoArquivo.endsWith('.pdf')) {
                // Utiliza a função universal compatível com v1 e v2
                textoDocumento = await extrairTextoPDF(req.file.buffer);
            } else {
                // Arquivo TXT comum
                textoDocumento = req.file.buffer.toString('utf-8');
            }

            if (!textoDocumento || textoDocumento.trim() === "") {
                return res.status(400).json({ erro: "Não foi possível extrair texto do documento enviado." });
            }

            // DESAFIO HACKER: RAG Persistente - Salva o texto no MongoDB associado ao operador
            if (mongoose.connection.readyState === 1) {
                await DocumentoSessaoModel.findOneAndUpdate(
                    { nickname: nomeOperador },
                    { nomeArquivo: nomeDoArquivo, conteudoTexto: textoDocumento, dataUpload: new Date() },
                    { upsert: true, new: true }
                );
            } else {
                documentosContingencia[nomeOperador] = { nomeArquivo: nomeDoArquivo, conteudoTexto: textoDocumento };
            }
        } else {
            // DESAFIO HACKER: Se o usuário não enviou arquivo novo, busca o documento já salvo no banco
            let docExistente = null;
            if (mongoose.connection.readyState === 1) {
                docExistente = await DocumentoSessaoModel.findOne({ nickname: nomeOperador }).lean();
            } else {
                docExistente = documentosContingencia[nomeOperador];
            }

            if (!docExistente) {
                return res.status(400).json({ erro: "Nenhum arquivo enviado e nenhum documento encontrado na memória da sua sessão." });
            }

            textoDocumento = docExistente.conteudoTexto;
            nomeDoArquivo = docExistente.nomeArquivo;
        }

        // 2. Engenharia de Prompt RAG Anti-Alucinação (Grounding Estrito)
        const promptRAG = `
Você é um analista de dados corporativo extremamente preciso.
Abaixo está um documento de referência. Responda à pergunta do usuário baseando-se APENAS no texto fornecido.
Se a resposta não estiver no texto, diga exatamente: "Desculpe, não encontrei essa informação no documento." NÃO INVENTE DADOS.

DOCUMENTO (${nomeDoArquivo}):
"""
${textoDocumento}
"""

PERGUNTA DO USUÁRIO: ${pergunta}
`;

        const modelIA = genAI.getGenerativeModel({ model: modeloAtivo });
        const result = await modelIA.generateContent(promptRAG);
        const respostaTexto = result.response.text();

        return res.status(200).json({ 
            sucesso: true, 
            resposta: respostaTexto,
            documentoAtivo: nomeDoArquivo,
            modo: "RAG Corporativo"
        });

    } catch (erro) {
        console.error("❌ ERRO NO PROCESSAMENTO RAG:", erro.message);
        return res.status(500).json({ sucesso: false, erro: `Falha no processamento do documento: ${erro.message}` });
    }
});

// Rota de Ranking Global
app.get('/api/ranking', async (req, res) => {
    try {
        const ranking = await JogadorModel.find().sort({ xp: -1 }).limit(10).lean();
        const rankingGamificado = ranking.map(jogador => {
            let titulo = "Novato";
            if (jogador.xp >= 500) titulo = "Lenda";
            else if (jogador.xp >= 300) titulo = "Mestre";
            else if (jogador.xp >= 100) titulo = "Guerreiro";
            return { nome: `${titulo}: ${jogador.nome}`, xp: jogador.xp };
        });
        res.status(200).json(rankingGamificado);
    } catch (e) {
        res.status(500).json({ erro: `Falha ao processar ranking: ${e.message}` });
    }
});

// Rota de Chat Comum (com Histórico e Function Calling)
app.post('/api/chat', async (req, res) => {
    try {
        const { pergunta, nickname, modelo } = req.body;
        if (!pergunta) return res.status(400).json({ erro: "Envie uma pergunta." });

        const nomeDoJogador = nickname ? nickname.trim() : "Visitante";
        const modeloAtivo = modelo || "gemini-2.5-flash"; 

        let docs = [];
        let usandoBanco = false;

        if (mongoose.connection.readyState === 1) {
            try {
                docs = await MensagemDbModel.find().sort({ dataHora: 1 }).limit(10).lean();
                usandoBanco = true;
            } catch (dbErr) {
                docs = memoriaContingencia.slice(-10);
            }
        } else {
            docs = memoriaContingencia.slice(-10);
        }

        const historicoSeguro = docs.map(d => ({
            role: d.role === "model" ? "model" : "user",
            parts: [{ text: d.parts?.[0]?.text || "" }]
        }));

        const modelIA = genAI.getGenerativeModel({ 
            model: modeloAtivo, 
            systemInstruction: `Você é o Mestre do Jogo e Guardião do conhecimento cibernético do SISTEMA N.E.O.N. 3.5.
            Trate o usuário pelo apelido informado: ${nomeDoJogador}.
            Regra do Jogo: Proponha desafios e charadas intrigantes sobre tecnologia, hacking e computação. 
            Se o usuário responder acertando a charada de forma justa, você DEVE obrigatoriamente chamar a função 'adicionarXP' passando o nickname '${nomeDoJogador}' e 50 pontos de quantidade.
            Se ele pedir a resposta, errar muito ou desistir, você deve chamar a função 'adicionarXP' e retirar 10 pontos (passando -10).
            Nunca revele no texto final a numeração exata de XP do usuário, apenas o parabenize ou lamente os pontos alterados. 
            Além disso, você continua capaz de executar buscas de clima e moedas quando o usuário solicitar.`,
            tools: [{ functionDeclarations: [declaracaoClima, declaracaoMoeda, declaracaoXP] }]
        }, { apiVersion: "v1beta" }); 

        const chatSession = modelIA.startChat({ history: historicoSeguro });
        let result = await chatSession.sendMessage(pergunta);
        let parts = result.response.candidates?.[0]?.content?.parts;
        let functionCallPart = parts?.find(p => p.functionCall);

        while (functionCallPart) {
            const { name, args } = functionCallPart.functionCall;
            let functionResult = {};

            if (name === "buscarClimaTempoReal") {
                functionResult = await buscarClimaTempoReal(args.cidade);
            } else if (name === "converterMoedas") {
                functionResult = await converterMoedas(args.valor, args.de, args.para);
            } else if (name === "adicionarXP") {
                const nickAlvo = args.nickname || nomeDoJogador;
                functionResult = await adicionarXP(nickAlvo, args.quantidade);
            }

            result = await chatSession.sendMessage([
                { functionResponse: { name: name, response: { result: functionResult } } }
            ]);

            parts = result.response.candidates?.[0]?.content?.parts;
            functionCallPart = parts?.find(p => p.functionCall);
        }

        const respostaTexto = result.response.text();

        if (usandoBanco && mongoose.connection.readyState === 1) {
            try {
                await MensagemDbModel.create({ role: "user", parts: [{ text: pergunta }] });
                await MensagemDbModel.create({ role: "model", parts: [{ text: respostaTexto }] });
            } catch (saveErr) {
                console.error("❌ Erro ao salvar histórico:", saveErr.message);
            }
        } else {
            memoriaContingencia.push({ role: "user", parts: [{ text: pergunta }] });
            memoriaContingencia.push({ role: "model", parts: [{ text: respostaTexto }] });
        }

        return res.status(200).json({ sucesso: true, resposta: respostaTexto });

    } catch (erro) {
        console.error("❌ ERRO NO PROCESSO:", erro.message);
        return res.status(500).json({ sucesso: false, erro: `Falha no Servidor: ${erro.message}` });
    }
});

// Limpeza das coleções (inclui a limpeza dos documentos RAG)
app.delete('/api/chat/limpar', async (req, res) => {
    try {
        memoriaContingencia = [];
        documentosContingencia = {};
        if (mongoose.connection.readyState === 1) {
            await MensagemDbModel.deleteMany({});
            await JogadorModel.deleteMany({});
            await DocumentoSessaoModel.deleteMany({});
        }
        res.json({ sucesso: true });
    } catch (e) { 
        res.status(500).json({ erro: "Erro ao redefinir base: " + e.message }); 
    }
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 SERVIDOR OPERACIONAL NA PORTA ${PORTA}`);
});