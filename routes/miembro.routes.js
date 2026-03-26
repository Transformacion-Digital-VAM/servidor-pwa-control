const express = require('express');
const router = express.Router();
const miembroController = require('../controllers/miembro.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/create', verifyToken, miembroController.createMiembro); //verifyToken
router.get('/get', verifyToken, miembroController.getMiembros); //verifyToken
router.get('/get/:id', verifyToken, miembroController.getMiembroById); //verifyToken
router.put('/update/:id', verifyToken, miembroController.updateMiembro); //verifyToken
router.delete('/delete/:id', verifyToken, miembroController.deleteMiembro); //verifyToken

module.exports = router;
