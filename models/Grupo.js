const mongoose = require('mongoose');

const grupoSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        trim: true
    },
    clave: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    diaVisita: {
        type: String,
        required: true
    },
    horaVisita: {
        type: String,
        required: true
    },
    cicloActual: {
        type: Number,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Grupo', grupoSchema);