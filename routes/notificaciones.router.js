const express = require('express');
const router = express.Router();
const webpush = require('web-push');

// Configurar VAPID keys
webpush.setVapidDetails(
    'mailto:' + process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

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

// Endpoint para enviar notificaciones (útil para testing)
router.post('/send', (req, res) => {
    try {
        const { title, body, icon } = req.body;

        if (!title || !body) {
            return res.status(400).json({ error: 'Título y cuerpo son requeridos' });
        }

        const payload = JSON.stringify({
            title,
            body,
            icon: icon || '/icons/android-chrome-192x192.png'
        });

        let successCount = 0;
        let failCount = 0;

        // Enviar a todas las suscripciones activas
        const promises = subscriptions.map(subscription =>
            webpush.sendNotification(subscription, payload)
                .then(() => {
                    successCount++;
                    console.log('[Push] Notificación enviada exitosamente');
                })
                .catch(error => {
                    failCount++;
                    console.error('[Push] Error enviando notificación:', error.message);
                    // Remover suscripciones inválidas
                    subscriptions = subscriptions.filter(sub => sub.endpoint !== subscription.endpoint);
                })
        );

        Promise.allSettled(promises).then(() => {
            res.json({
                message: `Notificaciones enviadas: ${successCount} exitosas, ${failCount} fallidas`,
                totalSubscriptions: subscriptions.length
            });
        });

    } catch (error) {
        console.error('[Push] Error enviando notificación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener el número de suscripciones activas
router.get('/subscriptions/count', (req, res) => {
    res.json({ count: subscriptions.length });
});

module.exports = router;