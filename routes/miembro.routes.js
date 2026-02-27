const express = require('express');
const router = express.Router();
const miembroController = require('../controllers/miembro.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/create', verifyToken, miembroController.createMiembro);
router.get('/get', verifyToken, miembroController.getMiembros);
router.get('/get/:id', verifyToken, miembroController.getMiembroById);
router.put('/update/:id', verifyToken, miembroController.updateMiembro);
router.delete('/delete/:id', verifyToken, miembroController.deleteMiembro);

module.exports = router;
