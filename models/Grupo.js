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
    },
    integrantes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Miembro'
    }],
    coordinacion: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Coordinacion'
    },
    asesor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Grupo', grupoSchema);