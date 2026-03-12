const express = require('express');
const router = express.Router();
const miembroController = require('../controllers/miembro.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/create', miembroController.createMiembro); //verifyToken
router.get('/get', miembroController.getMiembros); //verifyToken
router.get('/get/:id', miembroController.getMiembroById); //verifyToken
router.put('/update/:id', miembroController.updateMiembro); //verifyToken
router.delete('/delete/:id', miembroController.deleteMiembro); //verifyToken

module.exports = router;
