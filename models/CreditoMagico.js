const mongoose = require('mongoose');

const pagoMagicoSchema = new mongoose.Schema({
    numeroPago: { type: Number, required: true },
    montoPagado: { type: Number, required: true },
    efectivoCredito: { type: Number, default: 0 },
    transferenciaCredito: { type: Number, default: 0 },
    tarjetaCredito: { type: Number, default: 0 },
    depositoCredito: { type: Number, default: 0 },
    metodoPago: {
        type: String,
        enum: ['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'TARJETA', 'MIXTO'],
        default: 'EFECTIVO'
    },
    numeroRecibo: { type: String, required: false, default: null },
    totalPagado: { type: Number, default: 0 },
    esAdelanto: { type: Boolean, default: false },
    esAtraso: { type: Boolean, default: false },
    fechaPago: { type: Date, default: Date.now },
    ubicacion: {
        latitud: { type: Number, required: false },
        longitud: { type: Number, required: false }
    }
}, { _id: true });

const creditoMagicoSchema = new mongoose.Schema({
    miembro: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Miembro',
        required: true
    },
    grupo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Grupo',
        required: true
    },
    asesor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    coordinacion: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Coordinacion',
        required: false
    },
    campanaMes: {
        type: Number,
        enum: [4, 9, 12],
        required: true
    },
    campanaAnio: {
        type: Number,
        required: true
    },
    campanaClave: {
        type: String,
        required: true,
        trim: true
    },
    montoSolicitado: { type: Number, required: true },
    tasaInteres: { type: Number, required: true },
    semanas: { type: Number, default: 16, required: true },
    equivalenciaMeses: { type: Number, default: 4, required: true },
    pagoPactado: { type: Number, required: true },
    saldoTotal: { type: Number, required: true },
    saldoPendiente: { type: Number, required: true },
    garantia: { type: Number, default: 0 },
    diaPago: { type: String, required: true },
    horaVisita: { type: String, required: false },
    fechaPrimerPago: { type: Date, required: true },
    semanaActual: { type: Number, default: 1 },
    frecuenciaPago: { type: String, default: 'Semanal' },
    estado: {
        type: String,
        enum: ['Activo', 'Liquidado', 'Cancelado'],
        default: 'Activo'
    },
    pagos: [pagoMagicoSchema],
    motivoCancelacion: { type: String, default: null },
    fechaCancelacion: { type: Date, default: null },
    canceladoPor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    }
}, { timestamps: true });

creditoMagicoSchema.index({ miembro: 1, campanaClave: 1 }, { unique: true });
creditoMagicoSchema.index({ grupo: 1, estado: 1 });
creditoMagicoSchema.index({ asesor: 1, estado: 1 });
creditoMagicoSchema.index({ coordinacion: 1, campanaClave: 1 });
creditoMagicoSchema.index({ estado: 1 });

module.exports = mongoose.model('CreditoMagico', creditoMagicoSchema);

