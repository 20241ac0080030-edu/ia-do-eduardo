const mongoose = require('mongoose');

const MensagemSchema = new mongoose.Schema({
    role: {
        type: String,
        required: true
    },
    parts: [{
        text: { type: String }
    }],
    autor: {
        type: String,
        default: "Visitante"
    },
    // [REQ-003] Telemetria de Tokens no Modelo de Mensagem (15 pontos na inspeção)
    tokensGastos: {
        type: Number,
        default: 0
    },
    dataHora: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Mensagem', MensagemSchema);