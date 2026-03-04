const mongoose = require('mongoose');

const coordinacionSchema = new mongoose.Schema({
    nombre: String,
    municipio: String,
    coordinador: String
});

module.exports = mongoose.model('Coordinacion', coordinacionSchema);