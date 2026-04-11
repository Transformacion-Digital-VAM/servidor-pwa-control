const express = require('express');
const router = express.Router();

// Almacenamiento temporal de suscripciones (en producción usarías una base de datos)
let subscriptions = [];

// Endpoint para guardar suscripción push
router.post('/subscribe', (req, res) => {
    try {
        const subscription = req.body;

        // Validar que la suscripción tenga la estructura correcta
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ error: 'Suscripción inválida' });
        }

        // Agregar a la lista de suscripciones (evitar duplicados)
        const existingIndex = subscriptions.findIndex(sub =>
            sub.endpoint === subscription.endpoint
        );

        if (existingIndex === -1) {
            subscriptions.push(subscription);
            console.log('[Push] Nueva suscripción guardada:', subscription.endpoint);
        } else {
            subscriptions[existingIndex] = subscription;
            console.log('[Push] Suscripción actualizada:', subscription.endpoint);
        }

        res.status(201).json({ message: 'Suscripción guardada exitosamente' });
    } catch (error) {
        console.error('[Push] Error guardando suscripción:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para enviar notificaciones (deshabilitado - webpush removido)
router.post('/send', (req, res) => {
    try {
        const { title, body } = req.body;

        if (!title || !body) {
            return res.status(400).json({ error: 'Título y cuerpo son requeridos' });
        }

        // Notificación push deshabilitada (webpush removido)
        console.log('[Notificaciones] Endpoint /send ya no envía push notifications (webpush removido)');
        
        res.json({
            message: 'Servicio de push notifications deshabilitado',
            note: 'Webpush ha sido removido del proyecto',
            totalSubscriptions: subscriptions.length
        });

    } catch (error) {
        console.error('[Notificaciones] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener el número de suscripciones activas
router.get('/subscriptions/count', (req, res) => {
    res.json({ count: subscriptions.length });
});

module.exports = router;