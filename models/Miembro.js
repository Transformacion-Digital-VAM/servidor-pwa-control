const mongoose = require('mongoose');

const miembroSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        trim: true
    },
    apellidos: {
        type: String,
        required: true,
        trim: true
    },
    grupo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Grupo',
        required: true
    },
    rol: {
        type: String,
        enum: ['PRESIDENTA', 'TESORERA', 'SECRETARIA', 'INTEGRANTE'],
        required: true
    },
    pagoPactado: {
        type: Number,
        required: true,
        min: 0
    },
    pagos: [
        {
            numeroPago: {
                type: Number,
                required: true
            },
            fechaPago: Date,
            montoPagado: Number,
            pagado: {
                type: Boolean,
                default: false
            }
        }
    ]
}, { timestamps: true });

module.exports = mongoose.model('Miembro', miembroSchema);