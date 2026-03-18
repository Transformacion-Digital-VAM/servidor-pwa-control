require('dotenv').config({ path: 'variables.env' });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const app = express();
const userRoutes = require('./routes/user.routes');
const grupoRoutes = require('./routes/grupo.router');
const miembroRoutes = require('./routes/miembro.routes');
const clienteRoutes = require('./routes/cliente.router');
const creditoRoutes = require('./routes/credito.router');
// Conectar a la base de datos
connectDB();

// Middleware
app.use(cors({
  origin: [
    'http://192.168.1.237:8080',
    'http://127.0.0.1:8080',
    'http://localhost:4200'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/users', userRoutes);
app.use('/api/grupos', grupoRoutes);
app.use('/api/miembros', miembroRoutes);
app.use('/api/clientes', clienteRoutes);
app.use('/api/creditos', creditoRoutes);

// Iniciar el servidor
app.listen(3000, () => console.log('Server online: http://localhost:3000'));