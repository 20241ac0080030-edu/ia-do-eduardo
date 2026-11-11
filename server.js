require('dotenv').config();

// FORÇA O NODE.JS A USAR DNS PÚBLICO (Resolve o erro querySrv EBADRESP do MongoDB Atlas)
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mongoose = require('mongoose');
const multer = require('multer');
const pdfModule = require('pdf-parse');
const jwt = require('jsonwebtoken');

// ====================================================================
// IMPORTAÇÃO DOS MÓDULOS MODULARES DA SPRINT 8
// ====================================================================
const Usuario = require('./models/Usuario');         // [REQ-001]
const Mensagem = require('./models/Mensagem');       // [REQ-003]
const analyticsRoutes = require('./routes/analyticsRoutes'); // [REQ-005, REQ-006]
const autenticarToken = require('./middlewares/autenticarToken');

const app = express();
app.use(express.json());
app.use(cors());

// Servidor HTTP acoplado ao Express e Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Compartilha a instância do socket.io para ser acessada em rotas e controllers
app.set('io', io);

// Multer configurado em memória RAM (sem gravação em disco)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Até 10 MB
});

const JWT_SECRET = process.env.JWT_SECRET || 'neon_secret_jwt_corporativo_2026';

let memoriaContingencia = [];
let documentosContingencia = {};

// Função universal de extração de PDF (compatível com v1 e v2 do pdf-parse)
async function extrairTextoPDF(buffer) {
    try {
        if (typeof pdfModule === 'function') {
            const dados = await pdfModule(buffer);
            return dados.text;
        }
        if (pdfModule && typeof pdfModule.default === 'function') {
            const dados = await pdfModule.default(buffer);
            return dados.text;
        }
        if (pdfModule && pdfModule.PDFParse) {
            const parser = new pdfModule.PDFParse({ data: buffer });
            const resultado = await parser.getText();
            return resultado.text;
        }
        if (typeof pdfModule === 'object') {
            const Construtor = pdfModule.PDFParse || pdfModule;
            const parser = new Construtor({ data: buffer });
            if (typeof parser.getText === 'function') {
                const resultado = await parser.getText();
                return resultado.text;
            }
        }
    } catch (err) {
        throw new Error(`Falha na extração do PDF: ${err.message}`);
    }
    throw new Error("Incompatibilidade na versão da biblioteca pdf-parse instalada.");
}

// ====================================================================
// 1. CONEXÃO COM O BANCO DE DADOS MONGODB
// ====================================================================
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
      console.log('📦 BANCO DE DADOS ATIVO!');
      // Garante a existência do usuário admin padrão para testes do dashboard
      try {
          await Usuario.findOneAndUpdate(
              { nome: "admin" },
              { nome: "admin", role: "admin" },
              { upsert: true, new: true }
          );
      } catch (e) {}
  })
  .catch((err) => console.error('❌ ERRO MONGO (Modo de Contingência Ativo):', err.message));

// Schema de Jogador com XP (Gamificação)
const JogadorSchema = new mongoose.Schema({
    nome: { type: String, unique: true, required: true },
    xp: { type: Number, default: 0 }
});
const JogadorModel = mongoose.model('Jogador', JogadorSchema);

// Schema para RAG Persistente (Sprint 6)
const DocumentoSessaoSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    nomeArquivo: { type: String, required: true },
    conteudoTexto: { type: String, required: true },
    dataUpload: { type: Date, default: Date.now }
});
const DocumentoSessaoModel = mongoose.model('DocumentoSessao', DocumentoSessaoSchema);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper para salvar mensagens com telemetria no banco ou na contingência
async function salvarMensagemComTelemetria(role, texto, autor = "Visitante", tokensGastos = 0) {
    if (mongoose.connection.readyState === 1) {
        try {
            await Mensagem.create({
                role: role,
                parts: [{ text: texto }],
                autor: autor,
                tokensGastos: tokensGastos
            });
        } catch (e) {
            memoriaContingencia.push({ role, parts: [{ text: texto }], autor, tokensGastos });
        }
    } else {
        memoriaContingencia.push({ role, parts: [{ text: texto }], autor, tokensGastos });
    }
}

// ====================================================================
// 2. SEGURANÇA NO WEBSOCKET (HANDSHAKE COM JWT)
// ====================================================================
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
        return next(new Error("401 Unauthorized: Token JWT ausente no WebSocket"));
    }
    try {
        socket.usuario = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return next(new Error("401 Unauthorized: Token JWT inválido no WebSocket"));
    }
});

// ====================================================================
// 3. FERRAMENTAS DO AGENTE (FUNCTION CALLING)
// ====================================================================
async function adicionarXP(nickname, quantidade) {
    try {
        const nomeFormatado = nickname.trim();
        const jogador = await JogadorModel.findOneAndUpdate(
            { nome: nomeFormatado },
            { $inc: { xp: quantidade } },
            { new: true, upsert: true }
        );
        return { nickname: jogador.nome, xpAtual: jogador.xp, mensagem: `XP atualizado: ${jogador.xp}` };
    } catch (error) {
        return { erro: error.message };
    }
}

async function buscarClimaTempoReal(cidade) {
    try {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) return { erro: "Chave de clima ausente." };
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cidade)}&units=metric&lang=pt_br&appid=${apiKey}`;
        const response = await fetch(url);
        if (!response.ok) return { erro: `Cidade '${cidade}' não localizada.` };
        const data = await response.json();
        return { cidade: data.name, temperatura: `${Math.round(data.main.temp)}°C`, clima: data.weather[0].description };
    } catch (error) {
        return { erro: error.message };
    }
}

async function converterMoedas(valor, de, para) {
    try {
        const from = de.toUpperCase();
        const to = para.toUpperCase();
        if (from === to) return { valorConvertido: valor };
        const url = `https://api.frankfurter.app/latest?amount=${valor}&from=${from}&to=${to}`;
        const response = await fetch(url);
        if (!response.ok) return { erro: "Falha na conversão de moeda." };
        const data = await response.json();
        return { valorOriginal: valor, valorConvertido: data.rates[to].toFixed(2) };
    } catch (error) {
        return { erro: error.message };
    }
}

const declaracaoXP = {
    name: "adicionarXP",
    description: "Adiciona ou remove pontos de Experiência (XP).",
    parameters: {
        type: "OBJECT",
        properties: { nickname: { type: "STRING" }, quantidade: { type: "INTEGER" } },
        required: ["nickname", "quantidade"]
    }
};

const declaracaoClima = {
    name: "buscarClimaTempoReal",
    description: "Obtém temperatura e clima atual de uma cidade.",
    parameters: {
        type: "OBJECT",
        properties: { cidade: { type: "STRING" } },
        required: ["cidade"]
    }
};

const declaracaoMoeda = {
    name: "converterMoedas",
    description: "Converte valores financeiros entre moedas internacionais.",
    parameters: {
        type: "OBJECT",
        properties: { valor: { type: "NUMBER" }, de: { type: "STRING" }, para: { type: "STRING" } },
        required: ["valor", "de", "para"]
    }
};

// ====================================================================
// 4. ROTAS HTTP / REST
// ====================================================================

// SPRINT 8: Montagem do Módulo de Analytics protegido [REQ-006]
app.use('/api/analytics', analyticsRoutes);

// SPRINT 5: Health Check
app.get('/api/health', (req, res) => {
    return res.status(200).json({
        status: "ok",
        servidor: "operacional",
        bancoDeDados: mongoose.connection.readyState === 1 ? "conectado" : "contingencia",
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(process.uptime())} segundos`
    });
});

// Emissão de Token JWT com suporte a RBAC (Role-Based Access Control)
app.post('/api/auth/token', async (req, res) => {
    const { nickname, role } = req.body;
    const usuario = nickname ? nickname.trim() : "Visitante";
    
    // Concede role 'admin' se o nome for admin ou se solicitado
    const roleAtribuida = (role === "admin" || usuario.toLowerCase().includes("admin") || usuario.toLowerCase() === "eduardo") ? "admin" : "user";

    // Registra ou atualiza o usuário no modelo Usuario [REQ-001]
    if (mongoose.connection.readyState === 1) {
        try {
            await Usuario.findOneAndUpdate(
                { nome: usuario },
                { nome: usuario, role: roleAtribuida },
                { upsert: true, new: true }
            );
        } catch (e) {}
    }

    const token = jwt.sign(
        { nickname: usuario, role: roleAtribuida, cargo: roleAtribuida === "admin" ? "Diretor_Analytics" : "Operador_RealTime" },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    return res.status(200).json({ sucesso: true, token, role: roleAtribuida });
});

// SPRINT 6: RAG com Documentos (Protegida por JWT)
app.post('/api/chat/documento', autenticarToken, upload.single('documento'), async (req, res) => {
    try {
        const { pergunta, nickname, modelo } = req.body;
        if (!pergunta) return res.status(400).json({ erro: "Envie uma pergunta sobre o documento." });

        const nomeOperador = nickname ? nickname.trim() : (req.usuario?.nickname || "Visitante");
        const modeloAtivo = modelo || "gemini-2.5-flash";

        let textoDocumento = "";
        let nomeDoArquivo = "";

        if (req.file) {
            nomeDoArquivo = req.file.originalname;
            if (req.file.mimetype === 'application/pdf' || nomeDoArquivo.endsWith('.pdf')) {
                textoDocumento = await extrairTextoPDF(req.file.buffer);
            } else {
                textoDocumento = req.file.buffer.toString('utf-8');
            }

            if (!textoDocumento || textoDocumento.trim() === "") {
                return res.status(400).json({ erro: "Não foi possível extrair texto do documento." });
            }

            if (textoDocumento.length > 150000) {
                textoDocumento = textoDocumento.slice(0, 150000) + "\n\n[...Texto truncado para respeitar limites de cota...]";
            }

            if (mongoose.connection.readyState === 1) {
                await DocumentoSessaoModel.findOneAndUpdate(
                    { nickname: nomeOperador },
                    { nomeArquivo: nomeDoArquivo, conteudoTexto: textoDocumento, dataUpload: new Date() },
                    { upsert: true, new: true }
                );
            }
        } else {
            const docExistente = await DocumentoSessaoModel.findOne({ nickname: nomeOperador }).lean();
            if (!docExistente) {
                return res.status(400).json({ erro: "Nenhum documento encontrado na sessão." });
            }
            textoDocumento = docExistente.conteudoTexto;
            nomeDoArquivo = docExistente.nomeArquivo;
        }

        const promptRAG = `
Você é um analista corporativo extremamente preciso.
Responda à pergunta do usuário baseando-se APENAS no documento abaixo.
Se a resposta não estiver nele, responda estritamente: "Desculpe, não encontrei essa informação no documento." NÃO INVENTE DADOS.

DOCUMENTO (${nomeDoArquivo}):
"""
${textoDocumento}
"""

PERGUNTA: ${pergunta}
`;

        const modelIA = genAI.getGenerativeModel({ model: modeloAtivo });
        const result = await modelIA.generateContent(promptRAG);
        const respostaTexto = result.response.text();

        // [REQ-004] Captura de metadados da IA na resposta
        let tokensGastos = 0;
        if (result.response && result.response.usageMetadata && result.response.usageMetadata.totalTokenCount) {
            tokensGastos = result.response.usageMetadata.totalTokenCount;
        }

        // [REQ-003] Salva no modelo Mensagem com tokensGastos
        await salvarMensagemComTelemetria("user", pergunta, nomeOperador, 0);
        await salvarMensagemComTelemetria("model", respostaTexto, `RAG: ${nomeDoArquivo}`, tokensGastos);

        // Desafio Hacker: Notifica o Dashboard em tempo real
        io.emit('novoGastoDeToken', tokensGastos);

        return res.status(200).json({ 
            sucesso: true, 
            resposta: respostaTexto,
            documentoAtivo: nomeDoArquivo,
            tokensGastos: tokensGastos
        });

    } catch (erro) {
        return res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

// Ranking Global
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
        res.status(500).json({ erro: e.message });
    }
});

// Rota de Chat Comum com Telemetria e Function Calling
app.post('/api/chat', async (req, res) => {
    try {
        const { pergunta, nickname, modelo } = req.body;
        if (!pergunta) return res.status(400).json({ erro: "Envie uma pergunta." });

        const nomeDoJogador = nickname ? nickname.trim() : "Visitante";
        const modeloAtivo = modelo || "gemini-2.5-flash"; 

        const modelIA = genAI.getGenerativeModel({ 
            model: modeloAtivo, 
            systemInstruction: `Você é o Guardião do SISTEMA N.E.O.N. 3.5. Trate o usuário por ${nomeDoJogador}. Seja conciso.`,
            tools: [{ functionDeclarations: [declaracaoClima, declaracaoMoeda, declaracaoXP] }]
        }, { apiVersion: "v1beta" }); 

        const chatSession = modelIA.startChat({ history: [] });
        const result = await chatSession.sendMessage(pergunta);
        const respostaTexto = result.response.text();

        // [REQ-004] Captura de usageMetadata.totalTokenCount
        let tokensGastos = 0;
        if (result.response && result.response.usageMetadata && result.response.usageMetadata.totalTokenCount) {
            tokensGastos = result.response.usageMetadata.totalTokenCount;
        }

        // [REQ-003] Salva no MongoDB com tokensGastos
        await salvarMensagemComTelemetria("user", pergunta, nomeDoJogador, 0);
        await salvarMensagemComTelemetria("model", respostaTexto, "🤖 Moderador N.E.O.N.", tokensGastos);

        // Desafio Hacker: Atualização do Dashboard via Socket.io
        io.emit('novoGastoDeToken', tokensGastos);

        return res.status(200).json({ sucesso: true, resposta: respostaTexto, tokensGastos: tokensGastos });
    } catch (erro) {
        return res.status(500).json({ sucesso: false, erro: `Falha no Servidor: ${erro.message}` });
    }
});

// Limpeza de Banco
app.delete('/api/chat/limpar', async (req, res) => {
    try {
        memoriaContingencia = [];
        documentosContingencia = {};
        if (mongoose.connection.readyState === 1) {
            await Mensagem.deleteMany({});
            await JogadorModel.deleteMany({});
            await DocumentoSessaoModel.deleteMany({});
        }
        res.json({ sucesso: true });
    } catch (e) { 
        res.status(500).json({ erro: e.message }); 
    }
});

// ====================================================================
// 5. WEBSOCKETS EM TEMPO REAL COM TELEMETRIA (DESAFIO HACKER)
// ====================================================================
io.on('connection', (socket) => {
    const nomeUsuario = socket.usuario?.nickname || "Operador";

    io.emit('usuariosOnline', io.engine.clientsCount);

    socket.on('novaMensagem', async (dados) => {
        const texto = dados.texto ? dados.texto.trim() : "";
        if (!texto) return;

        const pacoteMensagem = {
            id: Date.now() + Math.random().toString(36).substring(2, 6),
            autor: nomeUsuario,
            texto: texto,
            tipo: 'usuario',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        io.emit('mensagemRecebida', pacoteMensagem);
        await salvarMensagemComTelemetria("user", texto, nomeUsuario, 0);

        // Gatilho de invocação @gemini / @neon
        const textoMin = texto.toLowerCase();
        if (textoMin.includes('@gemini') || textoMin.includes('@neon') || textoMin.includes('@bot')) {
            io.emit('usuarioDigitando', { usuario: '🤖 Moderador N.E.O.N.', digitando: true });

            try {
                const perguntaLimpa = texto.replace(/@gemini|@neon|@bot/gi, '').trim() || "Olá a todos!";

                const modelIA = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    systemInstruction: `Você é o Moderador N.E.O.N. em uma sala pública. Responda para "${nomeUsuario}" e para a sala inteira de forma curta e prestativa.`
                });

                const result = await modelIA.generateContent(perguntaLimpa);
                const respostaTexto = result.response.text();

                // [REQ-004] Captura de tokens no WebSocket
                let tokensGastos = 0;
                if (result.response && result.response.usageMetadata && result.response.usageMetadata.totalTokenCount) {
                    tokensGastos = result.response.usageMetadata.totalTokenCount;
                }

                // [REQ-003] Salva no MongoDB com tokensGastos
                await salvarMensagemComTelemetria("model", respostaTexto, '🤖 Moderador N.E.O.N.', tokensGastos);

                io.emit('mensagemRecebida', {
                    id: Date.now() + Math.random().toString(36).substring(2, 6),
                    autor: '🤖 Moderador N.E.O.N.',
                    texto: respostaTexto,
                    tipo: 'ia',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });

                // DESAFIO HACKER: Atualização em tempo real do Dashboard!
                io.emit('novoGastoDeToken', tokensGastos);

            } catch (err) {
                console.error("❌ Erro no Moderador IA:", err.message);
            } finally {
                io.emit('usuarioDigitando', { usuario: '🤖 Moderador N.E.O.N.', digitando: false });
            }
        }
    });

    socket.on('digitando', (isDigitando) => {
        socket.broadcast.emit('usuarioDigitando', {
            usuario: nomeUsuario,
            digitando: Boolean(isDigitando)
        });
    });

    socket.on('disconnect', () => {
        io.emit('usuariosOnline', io.engine.clientsCount);
    });
});

// ====================================================================
// INICIALIZAÇÃO DO SERVIDOR HÍBRIDO (HTTP + WEBSOCKET)
// ====================================================================
const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
    console.log(`🚀 SERVIDOR OPERACIONAL NA PORTA ${PORTA}`);
    console.log(`📊 Rotas de Analytics montadas em /api/analytics/tokens`);
});