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
    semanaActual: {
        type: String,
        required: true
    },
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
        // 1. PAGO DEL CRÉDITO (Liquidación / Abono)
        montoPagado: { type: Number, required: true },
        efectivoCredito: { type: Number, default: 0 },
        transferenciaCredito: { type: Number, default: 0 },
        tarjetaCredito: { type: Number, default: 0 },
        depositoCredito: { type: Number, default: 0 },

        // 2. PAGO SOLIDARIO
        pagoSolidario: { type: Boolean, default: false },
        montoSolidario: { type: Number, default: 0 },
        efectivoSolidario: { type: Number, default: 0 },
        transferenciaSolidario: { type: Number, default: 0 },
        tarjetaSolidario: { type: Number, default: 0 },
        depositoSolidario: { type: Number, default: 0 },

        // 3. PAGO AHORRO
        montoAhorro: { type: Number, default: 0 },
        efectivoAhorro: { type: Number, default: 0 },
        transferenciaAhorro: { type: Number, default: 0 },
        tarjetaAhorro: { type: Number, default: 0 },
        depositoAhorro: { type: Number, default: 0 },

        fechaPago: { type: Date, default: Date.now },
        metodoPago: {
            type: String,
            enum: ['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'TARJETA', 'MIXTO'],
            required: true
        },
        totalPagado: { type: Number, required: true },
        metodoPagoSolidario: { type: String, required: false },
        miembro: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Miembro',
            required: false
        },
        quienPrestoSolidario: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Miembro',
            required: function () {
                return this.pagoSolidario === true;
            }
        },
        recuperacionSolidario: {
            type: Boolean,
            default: false
        },
        numeroRecibo: { type: Number, required: false }
    }],
    garantia: {
        type: Number,
        default: 0
    },
    ahorro: {
        montoTotal: { type: Number, required: false },
        pagosAhorro: [{
            monto: { type: Number },
            fecha: { type: Date, default: Date.now }
        }],
        metodoPago: { type: String, required: false }
    },
    tasaInteres: { type: Number, required: true },
    montoSolicitado: { type: Number, required: true },
    frecuenciaPago: { type: String, required: true },
    garantiaPredial: { type: String, required: false },
    equivalenciaMeses: { type: Number, required: false },
    grupoOpcional: { type: String, required: false }

}, { timestamps: true });

creditoSchema.index({ miembro: 1, ciclo: 1, tipoCredito: 1 }, { unique: true });

module.exports = mongoose.model('Credito', creditoSchema);
