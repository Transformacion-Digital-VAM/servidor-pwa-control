const mongoose = require('mongoose');

const miembroSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    apellidos: { type: String, required: true },
    rol: {
        type: String,
        enum: ['PRESIDENTA', 'TESORERA', 'SECRETARIA', 'INTEGRANTE'],
        required: true
    },
    grupo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Grupo',
        required: true
    },
    ciclo: { 
        type: Number,
        required: false
    }
}, { timestamps: true });

module.exports = mongoose.model('Miembro', miembroSchema);
