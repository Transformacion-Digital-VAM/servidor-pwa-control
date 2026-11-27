const mongoose = require('mongoose');

const DEFAULT_LOGS_URI = 'mongodb+srv://servicevam2010_db_user:8E5LmaHq3G4HLXZT@cluster0.4cdwwxr.mongodb.net/db_logs_vam?retryWrites=true&w=majority';
const logsUri = process.env.MONGO_LOGS_URL || DEFAULT_LOGS_URI;

const logsConnection = mongoose.createConnection(logsUri);

logsConnection.on('connected', () => {
    console.log('Connected to MongoDB (Logs)');
});

logsConnection.on('error', (err) => {
    console.error('[LOGGER-DB] Error en conexión de logs:', err.message);
});

module.exports = logsConnection;
