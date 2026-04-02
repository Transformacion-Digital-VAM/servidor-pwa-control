const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.registerUser = async (req, res) => {
    const { username, password, role, coordinacion } = req.body;

    try {
        const existUser = await User.findOne({ username });
        if (existUser) {
            return res.status(400).json({
                message: 'Username already exists'
            });
        }

        const newUser = new User({
            username,
            password,
            role: role || 'asesor',
            coordinacion
        });

        await newUser.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Error creating user', error });
    }
}

exports.loginController = async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('Login attempt for:', username);
        const user = await User.findOne({ username });
        if (!user) {
            console.log('User not found:', username);
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const isMatch = await user.comparePassword(password);
        console.log('Password match:', isMatch);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate Token
        const token = jwt.sign(
            {
                id: user._id,
                username: user.username,
                role: user.role,
                coordinacion: user.coordinacion
            },
            process.env.JWT_SECRET || 'VAM2026#00',
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                username: user.username,
                role: user.role,
                coordinacion: user.coordinacion
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Error logging in' });
    }
};

exports.updateLocation = async (req, res) => {
    try {
        const { lat, lng, timestamp } = req.body;
        
        if (!lat || !lng) {
            return res.status(400).json({ message: 'Latitiud y longitud son requeridas' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        user.lastLocation = {
            lat,
            lng,
            timestamp: timestamp || new Date()
        };

        await user.save();
        
        res.status(200).json({ message: 'Ubicación actualizada correctamente', location: user.lastLocation });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ message: 'Error al actualizar ubicación', error });
    }
};

exports.getAllLocations = async (req, res) => {
    try {
        // Verificar si el usuario que hace la petición es 'master'
        if (req.user.role !== 'master') {
            return res.status(403).json({ 
                message: 'Acceso denegado. Solo el rol master puede obtener ubicaciones de otros usuarios.' 
            });
        }

        // Obtener usuarios que tengan ubicación registrada
        // Excluimos la contraseña y enviamos solo info útil para el mapa/panel
        const usersWithLocation = await User.find(
            { lastLocation: { $exists: true, $ne: null } },
            'username role coordinacion lastLocation'
        );

        res.status(200).json({ ok: true, users: usersWithLocation });
    } catch (error) {
        console.error('Error al obtener ubicaciones:', error);
        res.status(500).json({ message: 'Error al obtener ubicaciones', error });
    }
};
