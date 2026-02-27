const mongoose = require('mongoose');

const creditoSchema = new mongoose.Schema({
    miembro: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Miembro',
        required: true
    },

    ciclo: { type: Number, required: true },

    tipoCredito: {
        type: String,
        enum: ['CC', 'R', '8S'],
        required: true
    },

    semanas: { type: Number, required: true }, // 8 o 16
    pagoPactado: { type: Number, required: true },

    saldoTotal: { type: Number, required: true },
    saldoPendiente: { type: Number, required: true },

    estado: {
        type: String,
        enum: ['Activo', 'Liquidado'],
        default: 'Activo'
    },
    fechaPrimerPago: { type: Date, required: true },
    pagos: [{
        numeroPago: Number,
        montoPagado: Number,
        fechaPago: Date,
        pagoSolidario: Boolean
    }]

}, { timestamps: true });

creditoSchema.index({ miembro: 1, ciclo: 1 }, { unique: true });

module.exports = mongoose.model('Credito', creditoSchema);
