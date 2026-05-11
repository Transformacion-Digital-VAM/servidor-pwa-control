const Coordinacion = require('../models/Coordinacion');
const User = require('../models/User');
// Obtener todas las coordinaciones
exports.obtenerCoordinacion = async (req, res) => {
    try {
        const coordinaciones = await Coordinacion.find({}, {
            nombre: 1,
            municipio: 1,
            coordinador: 1,
        });

        res.json(coordinaciones);
    } catch (error) {
        console.log(error);
        res.status(500).send('Error');
    }
};

// Crear una coordinación
exports.crearCoordinacion = async (req, res) => {
    try {
        const { nombre, municipio, ejecutivas, coordinador } = req.body;

        const nuevaCoordinacion = new Coordinacion({
            nombre,
            municipio,
            ejecutivas,
            coordinador,
        });

        await nuevaCoordinacion.save();

        res.status(201).json({
            mensaje: 'Coordinación creada exitosamente',
            data: nuevaCoordinacion
        });

    } catch (error) {
        console.error('Error al crear coordinación:', error);
        res.status(500).json({ mensaje: 'Error al crear coordinación', error });
    }
};

exports.obtenerAsesores = async (req, res) => {
    try {
        const asesores = await User.find({ role: 'asesor' }, {
            username: 1,
            coordinacion: 1,
            lastLocation: 1,
        }).populate('coordinacion', 'nombre municipio');

        res.json(asesores);
    } catch (error) {
        console.log(error);
        res.status(500).send('Error');
    }
};

exports.obtenerAsesoresCoordinacion = async (req, res) => {
    try {
        const { coordinacion } = req.params;
        const asesores = await User.find({ role: 'asesor', coordinacion }, {
            username: 1,
            coordinacion: 1,
            lastLocation: 1,
        });

        res.json(asesores);
    } catch (error) {
        console.log(error);
        res.status(500).send('Error');
    }
};
