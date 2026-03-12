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
  origin: ['http://localhost:8080', 'http://localhost:4200', 'http://192.168.1.144:8080'],
  credentials: true,
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