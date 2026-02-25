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
    calendarioPagos: [
        {
            numeroPago: {
                type: Number,
                required: true
            },
            fechaProgramada: {
                type: Date,
                required: true
            }
        }
    ],
    integrantes: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Miembro'
        }
    ]
}, { timestamps: true });

module.exports = mongoose.model('Grupo', grupoSchema);