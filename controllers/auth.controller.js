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
