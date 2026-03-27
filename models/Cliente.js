const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true,
        trim: true
    },
    grupo: {
        type: String,
        required: false
    },
    diaPago: {
        type: String,
        required: true
    },
    tipoPago: {
        type: String,
        required: true
    },
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

module.exports = mongoose.model('Cliente', clienteSchema);