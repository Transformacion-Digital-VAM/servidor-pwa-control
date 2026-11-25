const fs = require('fs');
const path = require('path');

// Cargar variables de entorno localmente
if (fs.existsSync('variables.env')) {
  require('dotenv').config({ path: 'variables.env' });
} else {
  require('dotenv').config(); // cargar .env o usar Render
}

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const app = express();
const userRoutes = require('./routes/user.routes');
const grupoRoutes = require('./routes/grupo.router');
const miembroRoutes = require('./routes/miembro.routes');
const clienteRoutes = require('./routes/cliente.router');
const creditoRoutes = require('./routes/credito.router');
const notificacionesRoutes = require('./routes/notificaciones.router');
const logRoutes = require('./routes/log.router');
// Conectar a la base de datos
connectDB();

// Middleware
app.use(cors({
  origin: [
    'http://192.168.1.134:8080',
    'https://pwa-hcontrol-vam.web.app',
    'http://localhost:4200',
    'http://localhost:3000',
     '*'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Failover-Attempted']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { requestLoggerMiddleware } = require('./utils/loggers');
app.use(requestLoggerMiddleware);

// Rutas
app.use('/api/users', userRoutes);
app.use('/api/grupos', grupoRoutes);
app.use('/api/miembros', miembroRoutes);
app.use('/api/clientes', clienteRoutes);
app.use('/api/creditos', creditoRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/notifications', notificacionesRoutes); 
app.use('/api/logs', logRoutes);

// Endpoint de salud y diagnóstico de memoria
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024)
    }
  });
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  const mem = process.memoryUsage();
  console.log(`Server online on port ${PORT} | RAM inicial: ${Math.round(mem.rss/1024/1024)}MB`);
});
