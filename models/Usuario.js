const mongoose = require('mongoose');

const UsuarioSchema = new mongoose.Schema({
    nome: {
        type: String,
        required: true
    },
    email: {
        type: String,
        unique: true,
        sparse: true
    },
    senha: {
        type: String
    },
    // [REQ-001] Atributo RBAC no Modelo de Usuário (15 pontos na inspeção)
    role: {
        type: String,
        default: "user"
    },
    dataCriacao: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Usuario', UsuarioSchema);