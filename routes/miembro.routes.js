const express = require('express');
const router = express.Router();
const miembroController = require('../controllers/miembro.controller');

router.post('/create', miembroController.createMiembro);
router.get('/get', miembroController.getMiembros);
router.get('/get/:id', miembroController.getMiembroById);
router.put('/update/:id', miembroController.updateMiembro);
router.delete('/delete/:id', miembroController.deleteMiembro);

module.exports = router;
