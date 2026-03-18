const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/register', authController.registerUser);
router.post('/login', authController.loginController);
router.post('/location', verifyToken, authController.updateLocation);

module.exports = router;