const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.registerUser = async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // Check if user exists by username OR email
        const existUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existUser) {
            return res.status(400).json({
                message: existUser.username === username ? 'Username already exists' : 'Email already exists'
            });
        }

        const newUser = new User({
            username,
            email,
            password,
            role: 'user'
        });

        await newUser.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Error creating user' });
    }
}

exports.loginController = async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('Login attempt for:', email);
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found:', email);
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const isMatch = await user.comparePassword(password);
        console.log('Password match:', isMatch);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        res.json({ message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Error logging in' });
    }
};
