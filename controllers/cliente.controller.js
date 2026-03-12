const Cliente = require('../models/Cliente');

exports.createCliente = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "No tienes permisos para crear clientes" });
        }
        const cliente = new Cliente(req.body);
        await cliente.save();
        res.status(201).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getCliente = async (req, res) => {
    try {
        let query = {};
        if (req.user.role === 'asesor') {
            query = { asesor: req.user.id };
        } else if (req.user.role === 'coordinador') {
            query = { coordinacion: req.user.coordinacion };
        }
        const cliente = await Cliente.find(query).populate('coordinacion', 'nombre').populate('asesor', 'username');
        res.status(200).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getClientePorId = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "No tienes permisos para obtener clientes" });
        }
        const cliente = await Cliente.findById(req.params.id);
        res.status(200).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.updateCliente = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "No tienes permisos para actualizar clientes" });
        }
        const cliente = await Cliente.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.deleteCliente = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "No tienes permisos para eliminar clientes" });
        }
        const cliente = await Cliente.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Cliente eliminado con éxito", cliente });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}