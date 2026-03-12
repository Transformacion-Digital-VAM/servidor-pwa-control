const mongoose = require('mongoose');

const creditoSchema = new mongoose.Schema({
    miembro: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Miembro',
        required: false
    },
    cliente: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Cliente',
        required: false
    },
    ciclo: { type: Number, required: false },
    tipoCredito: {
        type: String,
        enum: ['CC', 'R', '8S', 'Individual'],
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
        numeroPago: { type: Number, required: true },
        montoPagado: { type: Number, required: true },
        fechaPago: { type: Date, default: Date.now },
        pagoSolidario: { type: Boolean, default: false },
        miembro: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Miembro',
            required: true
        },
        quienPrestoSolidario: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Miembro',
            required: function () {
                return this.pagoSolidario === true;
            }
        }
    }],
    garantia: {
        type: Number,
        required: true
    },
    ahorro: {
        montoTotal: { type: Number, required: false },
        pagosAhorro: [{
            monto: { type: Number },
            fecha: { type: Date, default: Date.now }
        }]
    }

}, { timestamps: true });

creditoSchema.index({ miembro: 1, ciclo: 1 }, { unique: true });

module.exports = mongoose.model('Credito', creditoSchema);
