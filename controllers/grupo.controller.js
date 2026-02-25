const Grupo = require('../models/Grupo');

exports.createGrupo = async (req, res) => {
    try {
        const grupo = new Grupo(req.body);
        await grupo.save();
        res.status(201).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getGrupos = async (req, res) => {
    try {
        const grupos = await Grupo.find().populate('integrantes');
        res.status(200).json(grupos);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getGrupoById = async (req, res) => {
    try {
        const grupo = await Grupo.findById(req.params.id).populate('integrantes');
        res.status(200).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.updateGrupo = async (req, res) => {
    try {
        const grupo = await Grupo.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.deleteGrupo = async (req, res) => {
    try {
        const grupo = await Grupo.findByIdAndDelete(req.params.id);
        res.status(200).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}