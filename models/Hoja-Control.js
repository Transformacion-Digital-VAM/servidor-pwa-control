const mongoose = require('mongoose');

const hojaControlSchema = new mongoose.Schema({
    grupo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Grupo',
        required: true
    },
    integrantes: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Integrante'
        }
    ],
    roles: {
        type: String,
        enum: ['socio', 'tesorero', 'secretario', 'vocal', 'auditor'],
        required: true
    },

});

module.exports = mongoose.model('HojaControl', hojaControlSchema);