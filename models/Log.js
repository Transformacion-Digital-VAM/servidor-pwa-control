const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
    accion: {
        type: String,
        required: true,
        index: true
    },
    nivel: {
        type: String,
        enum: ['EXITO', 'ADVERTENCIA', 'ERROR', 'HTTP', 'ALERTA'],
        default: 'EXITO',
        index: true
    },
    usuario: {
        id: { type: String },
        username: { type: String, index: true },
        nombre: { type: String },
        role: { type: String },
        coordinacion: { type: String },
        ip: { type: String }
    },
    descripcion: {
        type: String
    },
    datosEntrada: {
        type: mongoose.Schema.Types.Mixed
    },
    resultado: {
        type: mongoose.Schema.Types.Mixed
    },
    detalles: {
        type: mongoose.Schema.Types.Mixed
    },
    error: {
        mensaje: String,
        stack: String
    }
}, { 
    timestamps: true 
});

// Índice compuesto para acelerar búsquedas por fecha y acción
logSchema.index({ createdAt: -1, accion: 1 });
logSchema.index({ createdAt: -1, 'usuario.username': 1 });

module.exports = mongoose.model('Log', logSchema);
